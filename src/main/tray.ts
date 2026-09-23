import {
  app,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import icon from '../../resources/icon.png?asset'
import type { ServerConfig, StartOptions } from '../shared/types'
import { manager } from './ipc'
import { killPort } from './ports'
import { store } from './store'

let tray: Tray | null = null
let showWindow: () => void = () => {}

const isLive = (id: string): boolean => {
  const { status } = manager.getState(id)
  return status === 'running' || status === 'starting'
}

const portOf = (s: ServerConfig): number | undefined => manager.getState(s.id).activePort ?? s.port

/** Start from the tray; port conflicts are resolved with a native dialog since the window may be hidden. */
async function startFromTray(server: ServerConfig, opts?: StartOptions): Promise<void> {
  const res = await manager.start(server, opts)
  if (res.ok) return
  if (!('conflict' in res)) {
    dialog.showErrorBox(`Couldn't start ${server.name}`, res.error)
    return
  }
  const { port, owner, suggestedPort } = res.conflict
  const buttons = [
    'Kill it & start',
    ...(suggestedPort ? [`Use port ${suggestedPort}`] : []),
    'Cancel'
  ]
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Port in use',
    message: `Port ${port} is in use`,
    detail: `${server.name} wants port ${port}, but it is taken${owner ? ` by ${owner.name} (PID ${owner.pid})` : ''}.`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  })
  const choice = buttons[response]
  if (choice === 'Kill it & start') {
    await killPort(port)
    await new Promise((r) => setTimeout(r, 400))
    await startFromTray(server, port !== server.port ? { portOverride: port } : undefined)
  } else if (suggestedPort && choice === `Use port ${suggestedPort}`) {
    await startFromTray(server, { portOverride: suggestedPort })
  }
}

function buildMenu(): Menu {
  const servers = store.list()
  const live = servers.filter((s) => isLive(s.id))
  const idle = servers.filter((s) => !isLive(s.id))

  const liveItems: MenuItemConstructorOptions[] = live.length
    ? live.map((s) => {
        const port = portOf(s)
        const starting = manager.getState(s.id).status === 'starting'
        return {
          label: `${starting ? '◌' : '●'}  ${s.name}${port ? `  :${port}` : ''}${starting ? '  (starting)' : ''}`,
          submenu: [
            ...(port
              ? [
                  {
                    label: `Open http://localhost:${port}`,
                    click: () => shell.openExternal(`http://localhost:${port}`)
                  }
                ]
              : []),
            {
              label: 'Restart',
              click: async () => {
                const prev = manager.getState(s.id).activePort
                await manager.stop(s.id)
                await startFromTray(s, prev && prev !== s.port ? { portOverride: prev } : undefined)
              }
            },
            { label: 'Stop', click: () => manager.stop(s.id) }
          ]
        }
      })
    : [{ label: 'No servers running', enabled: false }]

  return Menu.buildFromTemplate([
    { label: 'DevStationnari', enabled: false },
    { type: 'separator' },
    ...liveItems,
    { type: 'separator' },
    {
      label: 'Start server',
      enabled: idle.length > 0,
      submenu: idle.length
        ? idle.map((s) => ({
            label: `${manager.getState(s.id).status === 'crashed' ? '✕  ' : ''}${s.name}${s.port ? `  :${s.port}` : ''}`,
            click: () => startFromTray(s)
          }))
        : [{ label: 'All servers are running', enabled: false }]
    },
    { label: 'Stop all', enabled: live.length > 0, click: () => manager.stopAll() },
    { type: 'separator' },
    { label: 'Open DevStationnari', click: () => showWindow() },
    { label: 'Quit (stops all servers)', click: () => app.quit() }
  ])
}

export function refreshTray(): void {
  if (!tray) return
  const running = store.list().filter((s) => isLive(s.id)).length
  tray.setToolTip(
    running
      ? `DevStationnari — ${running} server${running === 1 ? '' : 's'} running`
      : 'DevStationnari'
  )
  // Linux has no right-click event, so keep a static menu up to date there.
  if (process.platform === 'linux') tray.setContextMenu(buildMenu())
}

export function createTray(onShow: () => void): Tray {
  showWindow = onShow
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
  // Build the menu fresh on every right-click so it reflects current servers.
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))
  refreshTray()
  return tray
}

/** Windows balloon shown the first time the window is hidden to the tray. */
export function notifyHiddenToTray(): void {
  if (process.platform !== 'win32' || !tray) return
  tray.displayBalloon({
    iconType: 'info',
    title: 'DevStationnari is still running',
    content:
      'Your servers keep running. Right-click the tray icon to manage them, or choose Quit to stop everything.'
  })
}
