import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ServerConfig, ServerState, StartOptions, StartResult } from '../shared/types'
import { checkPort, killPort } from './ports'
import { ServerManager } from './serverManager'
import { store } from './store'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const statusListeners = new Set<(state: ServerState) => void>()

export function onStatusChange(cb: (state: ServerState) => void): void {
  statusListeners.add(cb)
}

export const manager = new ServerManager({
  log: (lines) => broadcast('log', lines),
  status: (state) => {
    broadcast('status', state)
    statusListeners.forEach((cb) => cb(state))
  }
})

function requireConfig(id: string): ServerConfig {
  const config = store.get(id)
  if (!config) throw new Error(`Unknown server ${id}`)
  return config
}

export function registerIpc(): void {
  ipcMain.handle('servers:list', () => store.list())
  ipcMain.handle('servers:states', () => manager.allStates())
  ipcMain.handle('servers:add', (_e, config: Omit<ServerConfig, 'id'>) => store.add(config))
  ipcMain.handle('servers:update', (_e, config: ServerConfig) => store.update(config))
  ipcMain.handle('servers:remove', async (_e, id: string) => {
    await manager.stop(id)
    manager.forget(id)
    store.remove(id)
  })

  ipcMain.handle('servers:start', (_e, id: string, opts?: StartOptions) =>
    manager.start(requireConfig(id), opts)
  )
  ipcMain.handle('servers:stop', (_e, id: string) => manager.stop(id))
  ipcMain.handle('servers:restart', async (_e, id: string): Promise<StartResult> => {
    // Keep the port override from the previous run, if any.
    const { portOverride } = manager.getState(id)
    const config = requireConfig(id)
    await manager.stop(id)
    return manager.start(config, { portOverride })
  })

  ipcMain.handle('logs:get', (_e, id: string) => manager.getLogs(id))
  ipcMain.handle('logs:clear', (_e, id: string) => manager.clearLogs(id))

  ipcMain.handle('ports:check', (_e, port: number) => checkPort(port))
  ipcMain.handle('ports:kill', (_e, port: number) => killPort(port))

  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
    return undefined
  })
}
