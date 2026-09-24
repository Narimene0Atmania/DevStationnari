import { spawn, type ChildProcess } from 'child_process'
import {
  PORT_PLACEHOLDER,
  type LogLine,
  type ServerConfig,
  type ServerState,
  type StartOptions,
  type StartResult
} from '../shared/types'
import { checkPort, isPortAccepting, killTree } from './ports'

const MAX_LOG_LINES = 2000
const READY_POLL_MS = 500
const READY_TIMEOUT_MS = 30_000
const LOG_FLUSH_MS = 50
const STOP_GRACE_MS = 5000
const KILL_GRACE_MS = 2000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g
// A local URL with an explicit port, as printed by Vite, Laravel, Django, Next, etc.
// Deliberately excludes LAN addresses so "Network: http://192.168.x.x:5173" is ignored.
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/i

interface Running {
  child: ChildProcess
  stopping: boolean
  exited: Promise<void>
  readyTimer?: NodeJS.Timeout
  /** Port we told the server to use (config or override), if any. */
  expectedPort?: number
  /** Port the server itself printed in its output, if it differs from expectedPort. */
  reportedPort?: number
}

/** Resolves true once the child has closed, false if the timeout elapses first. */
function exitedWithin(entry: Running, ms: number): Promise<boolean> {
  return Promise.race([
    entry.exited.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms))
  ])
}

/** Port a server announced in a line of output, or undefined. */
export function portFromOutput(line: string): number | undefined {
  const m = LOCAL_URL.exec(line)
  return m ? Number(m[1]) : undefined
}

type Emit = {
  log: (lines: LogLine[]) => void
  status: (state: ServerState) => void
}

export class ServerManager {
  private running = new Map<string, Running>()
  private states = new Map<string, ServerState>()
  private logs = new Map<string, LogLine[]>()
  private pending: LogLine[] = []
  private flushTimer?: NodeJS.Timeout

  constructor(private emit: Emit) {}

  getState(id: string): ServerState {
    return this.states.get(id) ?? { id, status: 'stopped' }
  }

  allStates(): ServerState[] {
    return [...this.states.values()]
  }

  getLogs(id: string): LogLine[] {
    return this.logs.get(id) ?? []
  }

  clearLogs(id: string): void {
    this.logs.set(id, [])
  }

  forget(id: string): void {
    this.states.delete(id)
    this.logs.delete(id)
  }

  async start(config: ServerConfig, opts: StartOptions = {}): Promise<StartResult> {
    if (this.running.has(config.id)) return { ok: true }

    const port = opts.portOverride ?? config.port
    const usesPlaceholder = config.command.includes(PORT_PLACEHOLDER)
    if (usesPlaceholder && !port) {
      return {
        ok: false,
        error: `The command uses ${PORT_PLACEHOLDER} but no port is set. Add a port or remove the placeholder.`
      }
    }
    if (port) {
      const check = await checkPort(port)
      if (!check.free) return { ok: false, conflict: check }
    }

    const command = port
      ? config.command.replaceAll(PORT_PLACEHOLDER, String(port))
      : config.command
    // PORT is set whenever a port is known: harmless for commands that ignore it, and
    // enough for the many Node servers that read it.
    const env: NodeJS.ProcessEnv = { ...process.env, ...config.env }
    if (port) env.PORT = String(port)

    let child: ChildProcess
    try {
      child = spawn(command, {
        cwd: config.cwd,
        env,
        shell: true,
        windowsHide: true,
        // Own process group on POSIX so we can kill the whole tree.
        detached: process.platform !== 'win32'
      })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    const entry: Running = {
      child,
      stopping: false,
      exited: new Promise((resolve) => child.once('close', () => resolve())),
      expectedPort: port
    }
    this.running.set(config.id, entry)

    this.log(config.id, 'system', `$ ${command}  (cwd: ${config.cwd})`)
    if (port) {
      const how = usesPlaceholder ? `${PORT_PLACEHOLDER} replaced and PORT env set` : 'PORT env set'
      this.log(config.id, 'system', `Port ${port}: ${how}`)
    }
    this.setState({
      id: config.id,
      status: 'starting',
      pid: child.pid,
      activePort: port,
      portOverride: opts.portOverride
    })

    this.pipe(config.id, entry, child.stdout, 'stdout')
    this.pipe(config.id, entry, child.stderr, 'stderr')

    child.once('error', (err) => this.log(config.id, 'system', `Failed to start: ${err.message}`))
    child.once('close', (code) => {
      clearTimeout(entry.readyTimer)
      this.running.delete(config.id)
      const crashed = !entry.stopping && code !== 0
      this.log(
        config.id,
        'system',
        entry.stopping ? 'Stopped' : `Process exited with code ${code ?? 'null'}`
      )
      this.setState({ id: config.id, status: crashed ? 'crashed' : 'stopped', exitCode: code })
    })

    if (port) this.waitForReady(config.id, entry)
    else this.setState({ ...this.getState(config.id), status: 'running' })

    return { ok: true }
  }

  async stop(id: string): Promise<void> {
    const entry = this.running.get(id)
    if (!entry) return
    entry.stopping = true
    const pid = entry.child.pid
    if (!pid) return
    // Ask nicely first, then force-kill anything that ignores SIGTERM.
    await killTree(pid, 'SIGTERM')
    if (await exitedWithin(entry, STOP_GRACE_MS)) return
    this.log(id, 'system', `Did not exit after ${STOP_GRACE_MS / 1000}s; force killing`)
    await killTree(pid, 'SIGKILL')
    await exitedWithin(entry, KILL_GRACE_MS)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)))
  }

  /**
   * Poll until something accepts connections on the expected port. If the server printed a
   * different local port in its output (e.g. Vite ignoring PORT), accept that one instead and
   * say so, so the UI never sits on "starting" for a port that will never open.
   */
  private waitForReady(id: string, entry: Running): void {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const ready = (port: number): void => {
      this.log(id, 'system', `Listening on http://localhost:${port}`)
      this.setState({ ...this.getState(id), status: 'running', activePort: port })
    }
    const tick = async (): Promise<void> => {
      if (this.running.get(id) !== entry || entry.stopping) return
      const expected = entry.expectedPort!
      if (await isPortAccepting(expected)) return ready(expected)
      if (entry.reportedPort && (await isPortAccepting(entry.reportedPort))) {
        this.log(
          id,
          'system',
          `Warning: asked for port ${expected} but the server is on ${entry.reportedPort}. ` +
            `Put ${PORT_PLACEHOLDER} in the command if it needs a flag instead of the PORT env var.`
        )
        return ready(entry.reportedPort)
      }
      if (Date.now() > deadline) {
        this.log(id, 'system', `Port ${expected} not open after 30s; marking as running anyway`)
        this.setState({ ...this.getState(id), status: 'running' })
        return
      }
      entry.readyTimer = setTimeout(tick, READY_POLL_MS)
    }
    entry.readyTimer = setTimeout(tick, READY_POLL_MS)
  }

  /** Remember the first local port the server announces, if it isn't the one we asked for. */
  private noticePort(id: string, entry: Running, text: string): void {
    if (entry.reportedPort) return
    // Vite and friends colour the port number, so strip escape codes before matching.
    const port = portFromOutput(text.replace(ANSI, ''))
    if (!port || port === entry.expectedPort) return
    if (entry.expectedPort) {
      entry.reportedPort = port
      return
    }
    // No port configured: adopt what the server printed so the "open" link works.
    entry.reportedPort = port
    this.log(id, 'system', `Detected port ${port} from output`)
    this.setState({ ...this.getState(id), activePort: port })
  }

  private pipe(
    id: string,
    entry: Running,
    stream: NodeJS.ReadableStream | null,
    kind: 'stdout' | 'stderr'
  ): void {
    if (!stream) return
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      const parts = (rest + chunk).split(/\r?\n/)
      rest = parts.pop() ?? ''
      for (const p of parts) {
        this.log(id, kind, p)
        this.noticePort(id, entry, p)
      }
    })
    stream.on('end', () => {
      if (rest) this.log(id, kind, rest)
    })
  }

  private log(serverId: string, stream: LogLine['stream'], raw: string): void {
    // Keep only what follows the last carriage return (progress-bar style output).
    const text = raw.slice(raw.lastIndexOf('\r') + 1).replace(ANSI, '')
    const line: LogLine = { serverId, stream, text, ts: Date.now() }
    const buf = this.logs.get(serverId) ?? []
    buf.push(line)
    if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES)
    this.logs.set(serverId, buf)

    this.pending.push(line)
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      const batch = this.pending
      this.pending = []
      this.emit.log(batch)
    }, LOG_FLUSH_MS)
  }

  private setState(state: ServerState): void {
    this.states.set(state.id, state)
    this.emit.status(state)
  }
}
