import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { manager, onStatusChange, registerIpc } from './ipc'
import { createTray, notifyHiddenToTray, refreshTray } from './tray'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let trayHintShown = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'DevStationnari',
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Closing the window hides it to the tray; servers keep running. Quit from the tray menu.
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      notifyHiddenToTray()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// One instance only: launching again brings the existing window back from the tray.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.devstationnari.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    createWindow()
    createTray(showWindow)
    onStatusChange(refreshTray)

    app.on('activate', showWindow)
  })
}

// Stop every managed server before quitting so no process is left holding a port.
let cleanedUp = false
app.on('before-quit', (e) => {
  isQuitting = true
  if (cleanedUp) return
  e.preventDefault()
  manager.stopAll().finally(() => {
    cleanedUp = true
    app.quit()
  })
})

// The tray keeps the app alive; quitting happens explicitly via the tray menu.
app.on('window-all-closed', () => {})
