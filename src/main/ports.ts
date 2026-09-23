import { execFile } from 'child_process'
import net from 'net'
import { promisify } from 'util'
import type { PortCheck, PortOwner } from '../shared/types'

const exec = promisify(execFile)
const isWin = process.platform === 'win32'

/** Try to bind the port on both IPv4 and IPv6 wildcard addresses. */
function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', (err: NodeJS.ErrnoException) => {
      // Host family not available on this machine: don't treat as "in use".
      resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')
    })
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen({ port, host, exclusive: true })
  })
}

export async function isPortFree(port: number): Promise<boolean> {
  if (!(await canListen(port, '0.0.0.0'))) return false
  if (!(await canListen(port, '::'))) return false
  // Some dev servers bind only to localhost; the wildcard bind can still succeed on Windows.
  return (await findPortPids(port)).length === 0
}

/** True if something accepts TCP connections on localhost:port. */
export function isPortAccepting(port: number): Promise<boolean> {
  const tryHost = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host })
      const done = (ok: boolean): void => {
        sock.destroy()
        resolve(ok)
      }
      sock.setTimeout(400, () => done(false))
      sock.once('connect', () => done(true))
      sock.once('error', () => done(false))
    })
  return tryHost('127.0.0.1').then((ok) => ok || tryHost('::1'))
}

async function findPortPids(port: number): Promise<number[]> {
  try {
    if (isWin) {
      const { stdout } = await exec('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true })
      const { stdout: stdout6 } = await exec('netstat', ['-ano', '-p', 'TCPv6'], {
        windowsHide: true
      })
      const pids = new Set<number>()
      for (const line of (stdout + '\n' + stdout6).split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/)
        // Proto  Local Address  Foreign Address  State  PID
        if (cols.length < 5 || cols[3] !== 'LISTENING') continue
        const local = cols[1]
        if (Number(local.slice(local.lastIndexOf(':') + 1)) === port) {
          const pid = Number(cols[4])
          if (pid > 0) pids.add(pid)
        }
      }
      return [...pids]
    }
    const { stdout } = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    return [...new Set(stdout.split(/\s+/).filter(Boolean).map(Number))]
  } catch {
    // lsof exits 1 when nothing matches.
    return []
  }
}

async function processName(pid: number): Promise<string> {
  try {
    if (isWin) {
      const { stdout } = await exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true
      })
      const m = stdout.match(/^"([^"]+)"/m)
      return m ? m[1] : 'unknown'
    }
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'comm='])
    return stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function findPortOwner(port: number): Promise<PortOwner | undefined> {
  const [pid] = await findPortPids(port)
  if (!pid) return undefined
  return { pid, name: await processName(pid) }
}

export async function findFreePort(start: number, limit = 100): Promise<number | undefined> {
  for (let p = start; p < Math.min(start + limit, 65536); p++) {
    if (await isPortFree(p)) return p
  }
  return undefined
}

export async function checkPort(port: number): Promise<PortCheck> {
  if (await isPortFree(port)) return { port, free: true }
  const [owner, suggestedPort] = await Promise.all([findPortOwner(port), findFreePort(port + 1)])
  return { port, free: false, owner, suggestedPort }
}

/** Kill the whole process tree rooted at pid. */
export async function killTree(pid: number): Promise<void> {
  try {
    if (isWin) {
      await exec('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
    }
  } catch {
    // Already gone.
  }
}

export async function killPort(port: number): Promise<boolean> {
  const pids = await findPortPids(port)
  await Promise.all(pids.map(killTree))
  return pids.length > 0
}
