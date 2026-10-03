import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { createBackend } from '../platform/database/backend'
import { registerDataIPC } from '../platform/electron/main/data-ipc'
import {
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE,
  BROWSER_SET_VISIBLE
} from '../shared/browser'
import { createMainWindow } from './window'
import type { BrowserManager } from './browser/BrowserManager'

let browser: BrowserManager | undefined
let backend: ReturnType<typeof createBackend> | undefined

app.whenReady().then(() => {
  backend = createBackend(join(app.getPath('userData'), 'database.sqlite'))
  registerDataIPC(backend, join(__dirname, '../renderer/index.html'))
  const created = createMainWindow()
  browser = created.browser

  app.on('activate', () => {
    if (browserWindowCount() === 0) {
      const next = createMainWindow()
      browser = next.browser
    }
  })
}).catch(() => {
  // Do not show raw SQLite errors/paths; initialization failure must never silently reset user data.
  dialog.showErrorBox('Storage unavailable', 'The database could not be opened or migrated. Your database has not been reset.')
  app.quit()
})

app.on('will-quit', () => { backend?.close(); backend = undefined })

ipcMain.handle(BROWSER_NAVIGATE, async (event, input: unknown) => {
  assertTrustedRenderer(event.sender.id)
  if (typeof input !== 'string') throw new Error('Navigation input must be text.')
  await requireBrowser().navigate(input)
})
ipcMain.handle(BROWSER_BACK, (event) => {
  assertTrustedRenderer(event.sender.id)
  requireBrowser().back()
})
ipcMain.handle(BROWSER_FORWARD, (event) => {
  assertTrustedRenderer(event.sender.id)
  requireBrowser().forward()
})
ipcMain.handle(BROWSER_GET_STATE, (event) => {
  assertTrustedRenderer(event.sender.id)
  return requireBrowser().getState()
})
ipcMain.handle(BROWSER_SET_VISIBLE, (event, visible: unknown) => {
  assertTrustedRenderer(event.sender.id)
  if (typeof visible !== 'boolean') throw new Error('Browser visibility must be a boolean.')
  requireBrowser().setVisible(visible)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function requireBrowser(): BrowserManager {
  if (!browser) throw new Error('Browser is not ready.')
  return browser
}

function assertTrustedRenderer(senderId: number): void {
  const mainWindow = getWindows().find((window) => window.webContents.id === senderId)
  if (!mainWindow) throw new Error('Untrusted IPC sender.')
}

function getWindows() {
  return BrowserWindow.getAllWindows()
}

function browserWindowCount(): number {
  return getWindows().length
}
