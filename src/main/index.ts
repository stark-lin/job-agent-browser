import { app, BrowserWindow, ipcMain } from 'electron'
import {
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE
} from '../shared/browser'
import { createMainWindow } from './window'
import type { BrowserManager } from './browser/BrowserManager'

let browser: BrowserManager | undefined

app.whenReady().then(() => {
  const created = createMainWindow()
  browser = created.browser

  app.on('activate', () => {
    if (browserWindowCount() === 0) {
      const next = createMainWindow()
      browser = next.browser
    }
  })
})

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
