import { afterEach, describe, expect, it } from 'vitest'
import type { LogLine, ServerConfig, ServerState } from '../shared/types'
import { ServerManager, portFromOutput } from './serverManager'

const isWin = process.platform === 'win32'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A node one-liner that listens on `port` and prints `banner` (a JS single-quoted string body). */
const httpServer = (port: number | string, banner = 'up'): string =>
  `node -e "require('http').createServer().listen(${port},()=>{console.log('${banner}')})"`

function makeManager(): { m: ServerManager; logs: LogLine[]; states: ServerState[] } {
  const logs: LogLine[] = []
  const states: ServerState[] = []
  const m = new ServerManager({
    log: (lines) => logs.push(...lines),
    status: (s) => states.push(s)
  })
  return { m, logs, states }
}

const config = (over: Partial<ServerConfig>): ServerConfig => ({
  id: 'srv',
  name: 'srv',
  cwd: process.cwd(),
  command: 'true',
  ...over
})

/** Poll until the server's status matches, or fail after `ms`. */
async function waitForStatus(m: ServerManager, status: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms
  while (m.getState('srv').status !== status) {
    if (Date.now() > deadline)
      throw new Error(`status is ${m.getState('srv').status}, wanted ${status}`)
    await sleep(100)
  }
}

const systemText = (logs: LogLine[]): string =>
  logs
    .filter((l) => l.stream === 'system')
    .map((l) => l.text)
    .join('\n')

describe('portFromOutput', () => {
  it('reads Vite, Laravel, Django and IPv6 banners', () => {
    expect(portFromOutput('  ➜  Local:   http://localhost:5173/')).toBe(5173)
    expect(portFromOutput('INFO  Server running on [http://127.0.0.1:8001].')).toBe(8001)
    expect(portFromOutput('Starting development server at http://0.0.0.0:8000/')).toBe(8000)
    expect(portFromOutput('listening on http://[::1]:3000')).toBe(3000)
  })
  it('ignores LAN addresses and URLs without a port', () => {
    expect(portFromOutput('  ➜  Network: http://192.168.1.3:5173/')).toBeUndefined()
    expect(portFromOutput('APP_URL: http://localhost')).toBeUndefined()
  })
})

describe('ServerManager', () => {
  let current: ServerManager | undefined
  afterEach(async () => {
    await current?.stopAll()
    current = undefined
  })

  it('replaces {port} in the command and reports running once the port opens', async () => {
    const { m, logs } = makeManager()
    current = m
    const res = await m.start(config({ port: 0, command: httpServer('{port}') }), {
      portOverride: 47001
    })
    expect(res).toEqual({ ok: true })
    await waitForStatus(m, 'running')
    expect(systemText(logs)).toContain('listen(47001')
    expect(systemText(logs)).toContain('{port} replaced and PORT env set')
    expect(m.getState('srv')).toMatchObject({ activePort: 47001, portOverride: 47001 })
  })

  it('refuses {port} when no port is configured', async () => {
    const { m } = makeManager()
    const res = await m.start(config({ command: 'echo {port}' }))
    expect(res.ok).toBe(false)
    expect('error' in res && res.error).toContain('{port}')
  })

  it('switches to the port the server announces when it ignores the requested one', async () => {
    const { m, logs } = makeManager()
    current = m
    // Vite-style: a LAN line first, then the local URL with the port in bold escape codes.
    const banner =
      '  ➜  Network: http://192.168.1.3:47011/\\n  ➜  Local:   http://localhost:\\u001b[1m47011\\u001b[22m/'
    await m.start(config({ port: 47010, command: httpServer(47011, banner) }))
    await waitForStatus(m, 'running')
    expect(m.getState('srv').activePort).toBe(47011)
    expect(systemText(logs)).toContain('asked for port 47010 but the server is on 47011')
  })

  it('adopts the announced port when none is configured', async () => {
    const { m, logs } = makeManager()
    current = m
    await m.start(config({ command: httpServer(47020, 'Listening on http://127.0.0.1:47020') }))
    await sleep(800)
    expect(m.getState('srv').activePort).toBe(47020)
    expect(systemText(logs)).toContain('Detected port 47020')
    expect(systemText(logs)).not.toContain('PORT env set')
  })

  it('reports a port conflict instead of starting', async () => {
    const { m } = makeManager()
    current = m
    await m.start(config({ id: 'srv', port: 47030, command: httpServer(47030) }))
    await waitForStatus(m, 'running')
    const other = new ServerManager({ log: () => {}, status: () => {} })
    const res = await other.start(config({ id: 'other', port: 47030 }))
    expect(res.ok).toBe(false)
    expect('conflict' in res && res.conflict.port).toBe(47030)
  })

  it('marks a non-zero exit as crashed and a stop as stopped', async () => {
    const { m } = makeManager()
    current = m
    await m.start(config({ command: 'exit 3' }))
    await waitForStatus(m, 'crashed')
    expect(m.getState('srv').exitCode).toBe(3)

    await m.start(config({ port: 47040, command: httpServer(47040) }))
    await waitForStatus(m, 'running')
    await m.stop('srv')
    expect(m.getState('srv').status).toBe('stopped')
  })

  // macOS/Linux only. Windows has no SIGTERM: killTree runs `taskkill /F`, which is always
  // forced, so there is no escalation path to test there and the case is skipped.
  it.skipIf(isWin)(
    'force-kills a process that ignores SIGTERM (macOS/Linux only; skipped on Windows)',
    async () => {
      const { m, logs } = makeManager()
      current = m
      await m.start(config({ command: `trap '' TERM; echo trapped; while :; do sleep 1; done` }))
      // Wait until the shell has installed the trap, or SIGTERM would just work.
      const deadline = Date.now() + 5000
      while (!logs.some((l) => l.text === 'trapped')) {
        if (Date.now() > deadline) throw new Error('shell never printed "trapped"')
        await sleep(50)
      }
      const pid = m.getState('srv').pid!
      await m.stop('srv')
      await sleep(100) // let the batched log flush
      expect(systemText(logs)).toContain('force killing')
      expect(m.getState('srv').status).toBe('stopped')
      await sleep(200)
      expect(() => process.kill(pid, 0)).toThrow()
    },
    12_000
  )
})
