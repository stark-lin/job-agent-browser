import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBackend } from '../../database/backend'
import { trustedDataSender, registerDataIPC } from './data-ipc'
import {
  BROWSER_BACK,
  BROWSER_CREATE_TAB,
  BROWSER_ACTIVATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE,
  BROWSER_SET_VISIBLE
} from '../../../shared/browser'
import { createMainWindow } from './window'
import type { BrowserManager } from '../../browser/browserManager'

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
  assertTrustedRenderer(event)
  if (typeof input !== 'string') throw new Error('Navigation input must be text.')
  await requireBrowser().navigate(input)
})
ipcMain.handle(BROWSER_BACK, (event) => {
  assertTrustedRenderer(event)
  requireBrowser().back()
})
ipcMain.handle(BROWSER_FORWARD, (event) => {
  assertTrustedRenderer(event)
  requireBrowser().forward()
})
ipcMain.handle(BROWSER_GET_STATE, (event) => {
  assertTrustedRenderer(event)
  return requireBrowser().getState()
})
ipcMain.handle(BROWSER_SET_VISIBLE, (event, visible: unknown, presentation: unknown) => {
  assertTrustedRenderer(event)
  if (typeof visible !== 'boolean') throw new Error('Browser visibility must be a boolean.')
  if (!presentation || typeof presentation !== 'object' ||
    !('tabId' in presentation) || typeof presentation.tabId !== 'string' ||
    !('targetId' in presentation) || typeof presentation.targetId !== 'string') {
    throw new Error('Browser presentation must identify a tab and target.')
  }
  requireBrowser().setVisible(visible, { tabId: presentation.tabId, targetId: presentation.targetId })
})

ipcMain.handle(BROWSER_CREATE_TAB, (event) => {
  assertTrustedRenderer(event)
  requireBrowser().createTab()
})
ipcMain.handle(BROWSER_ACTIVATE_TAB, (event, id: unknown) => {
  assertTrustedRenderer(event)
  if (typeof id !== 'string') throw new Error('Tab ID must be text.')
  requireBrowser().activateTab(id)
})
ipcMain.handle(BROWSER_CLOSE_TAB, (event, id: unknown) => {
  assertTrustedRenderer(event)
  if (typeof id !== 'string') throw new Error('Tab ID must be text.')
  requireBrowser().closeTab(id)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function requireBrowser(): BrowserManager {
  if (!browser) throw new Error('Browser is not ready.')
  return browser
}

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  if (!trustedDataSender({ windowOwned: requireBrowser().isTrustedSender(event.sender.id),
    mainFrame: event.senderFrame === event.sender.mainFrame, url: event.senderFrame?.url ?? '' }, expectedURL)) {
    throw new Error('Untrusted IPC sender.')
  }
}

function getWindows() {
  return BrowserWindow.getAllWindows()
}

function browserWindowCount(): number {
  return getWindows().length
}
