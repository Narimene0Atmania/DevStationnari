import { spawn, type ChildProcess } from 'child_process'
import type { LogLine, ServerConfig, ServerState, StartOptions, StartResult } from '../shared/types'
import { checkPort, isPortAccepting, killTree } from './ports'

const MAX_LOG_LINES = 2000
const READY_POLL_MS = 500
const READY_TIMEOUT_MS = 30_000
const LOG_FLUSH_MS = 50
const STOP_GRACE_MS = 5000
const KILL_GRACE_MS = 2000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

interface Running {
  child: ChildProcess
  stopping: boolean
  exited: Promise<void>
  readyTimer?: NodeJS.Timeout
}

/** Resolves true once the child has closed, false if the timeout elapses first. */
function exitedWithin(entry: Running, ms: number): Promise<boolean> {
  return Promise.race([
    entry.exited.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms))
  ])
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
    if (port) {
      const check = await checkPort(port)
      if (!check.free) return { ok: false, conflict: check }
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ...config.env }
    if (opts.portOverride) env.PORT = String(opts.portOverride)

    let child: ChildProcess
    try {
      child = spawn(config.command, {
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
      exited: new Promise((resolve) => child.once('close', () => resolve()))
    }
    this.running.set(config.id, entry)

    this.log(config.id, 'system', `$ ${config.command}  (cwd: ${config.cwd})`)
    if (opts.portOverride) this.log(config.id, 'system', `PORT=${opts.portOverride} injected`)
    this.setState({ id: config.id, status: 'starting', pid: child.pid, activePort: port })

    this.pipe(config.id, child.stdout, 'stdout')
    this.pipe(config.id, child.stderr, 'stderr')

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

    if (port) this.waitForReady(config.id, port, entry)
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

  private waitForReady(id: string, port: number, entry: Running): void {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const tick = async (): Promise<void> => {
      if (this.running.get(id) !== entry || entry.stopping) return
      if (await isPortAccepting(port)) {
        this.log(id, 'system', `Listening on http://localhost:${port}`)
        this.setState({ ...this.getState(id), status: 'running' })
        return
      }
      if (Date.now() > deadline) {
        this.log(id, 'system', `Port ${port} not open after 30s; marking as running anyway`)
        this.setState({ ...this.getState(id), status: 'running' })
        return
      }
      entry.readyTimer = setTimeout(tick, READY_POLL_MS)
    }
    entry.readyTimer = setTimeout(tick, READY_POLL_MS)
  }

  private pipe(id: string, stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr'): void {
    if (!stream) return
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      const parts = (rest + chunk).split(/\r?\n/)
      rest = parts.pop() ?? ''
      for (const p of parts) this.log(id, kind, p)
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
