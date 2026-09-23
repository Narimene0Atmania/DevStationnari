import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DevStationApi, LogLine, ServerState } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DevStationApi = {
  list: () => ipcRenderer.invoke('servers:list'),
  states: () => ipcRenderer.invoke('servers:states'),
  add: (config) => ipcRenderer.invoke('servers:add', config),
  update: (config) => ipcRenderer.invoke('servers:update', config),
  remove: (id) => ipcRenderer.invoke('servers:remove', id),
  start: (id, opts) => ipcRenderer.invoke('servers:start', id, opts),
  stop: (id) => ipcRenderer.invoke('servers:stop', id),
  restart: (id) => ipcRenderer.invoke('servers:restart', id),
  getLogs: (id) => ipcRenderer.invoke('logs:get', id),
  clearLogs: (id) => ipcRenderer.invoke('logs:clear', id),
  checkPort: (port) => ipcRenderer.invoke('ports:check', port),
  killPort: (port) => ipcRenderer.invoke('ports:kill', port),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onLog: (cb) => subscribe<LogLine[]>('log', cb),
  onStatus: (cb) => subscribe<ServerState>('status', cb)
}

contextBridge.exposeInMainWorld('api', api)
