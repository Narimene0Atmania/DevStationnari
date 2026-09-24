import net from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPort, findFreePort, isPortAccepting, isPortFree } from './ports'

const servers: net.Server[] = []

/** Listen on an OS-assigned port on localhost and return it. */
function listen(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    servers.push(srv)
    srv.listen(0, host, () => resolve((srv.address() as net.AddressInfo).port))
  })
}

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  servers.length = 0
})

describe('isPortFree / isPortAccepting', () => {
  it('reports a listening port as taken and accepting', async () => {
    const port = await listen()
    expect(await isPortFree(port)).toBe(false)
    expect(await isPortAccepting(port)).toBe(true)
  })

  it('reports a closed port as free and not accepting', async () => {
    const port = await listen()
    await new Promise((r) => servers.pop()!.close(r))
    expect(await isPortFree(port)).toBe(true)
    expect(await isPortAccepting(port)).toBe(false)
  })
})

describe('checkPort', () => {
  it('names the owning process and suggests the next free port', async () => {
    const port = await listen()
    const res = await checkPort(port)
    expect(res.free).toBe(false)
    expect(res.port).toBe(port)
    // Owner lookup needs lsof/netstat; when available it must point at this process.
    if (res.owner) expect(res.owner.pid).toBe(process.pid)
    expect(res.suggestedPort).toBeGreaterThan(port)
    expect(await isPortFree(res.suggestedPort!)).toBe(true)
  })

  it('returns free for an unused port', async () => {
    const port = await listen()
    await new Promise((r) => servers.pop()!.close(r))
    expect(await checkPort(port)).toEqual({ port, free: true })
  })
})

describe('findFreePort', () => {
  it('skips taken ports', async () => {
    const taken = await listen()
    const found = await findFreePort(taken, 10)
    expect(found).toBeDefined()
    expect(found).not.toBe(taken)
    expect(found!).toBeGreaterThan(taken)
  })

  it('gives up within the limit', async () => {
    const taken = await listen()
    expect(await findFreePort(taken, 1)).toBeUndefined()
  })
})
