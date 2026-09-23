import { execFileSync } from 'child_process'
import {
  app,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
// Electron loads the @1.5x / @2x siblings automatically for high-DPI displays.
import trayDark from '../../resources/tray/tray-dark.png?asset'
import trayDarkRunning from '../../resources/tray/tray-dark-running.png?asset'
import trayWhite from '../../resources/tray/tray-white.png?asset'
import trayWhiteRunning from '../../resources/tray/tray-white-running.png?asset'
import type { ServerConfig, StartOptions } from '../shared/types'
import { manager } from './ipc'
import { killPort } from './ports'
import { store } from './store'

let tray: Tray | null = null
let showWindow: () => void = () => {}
let taskbarIsLight = false
let currentIcon = ''

/** Windows themes the taskbar separately from apps, so read its setting directly. */
function readTaskbarIsLight(): boolean {
  if (process.platform !== 'win32') return !nativeTheme.shouldUseDarkColors
  try {
    const out = execFileSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'SystemUsesLightTheme'
      ],
      { windowsHide: true, encoding: 'utf8' }
    )
    return /0x1\b/.test(out)
  } catch {
    return false // Value missing on older Windows 10 builds: taskbar is dark.
  }
}

function trayImage(running: boolean): { key: string; image: NativeImage } {
  // macOS: a dark template image that the menu bar recolors itself.
  if (process.platform === 'darwin') {
    const key = running ? trayDarkRunning : trayDark
    const image = nativeImage.createFromPath(key)
    if (!running) image.setTemplateImage(true)
    return { key, image }
  }
  const key = taskbarIsLight
    ? running
      ? trayDarkRunning
      : trayDark
    : running
      ? trayWhiteRunning
      : trayWhite
  return { key, image: nativeImage.createFromPath(key) }
}

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
  const { key, image } = trayImage(running > 0)
  if (key !== currentIcon) {
    currentIcon = key
    tray.setImage(image)
  }
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
  taskbarIsLight = readTaskbarIsLight()
  const initial = trayImage(false)
  currentIcon = initial.key
  tray = new Tray(initial.image)
  // Fires when the Windows/macOS theme changes; swap the glyph to stay visible.
  nativeTheme.on('updated', () => {
    taskbarIsLight = readTaskbarIsLight()
    currentIcon = ''
    refreshTray()
  })
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
