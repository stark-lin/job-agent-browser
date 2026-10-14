import { t, i18n } from '../../../shared/i18n'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { createPreferences } from '../../storage/preferences'
import { createSecrets } from '../../storage/secrets'
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
  BROWSER_SET_VISIBLE,
  BROWSER_SET_UNSAVED
} from '../../../shared/browser'
import { createMainWindow } from './window'
import { applyTheme } from './theme'
import type { BrowserManager } from '../../browser/browserManager'

let browser: BrowserManager | undefined
let backend: ReturnType<typeof createBackend> | undefined
let preferences: ReturnType<typeof createPreferences>
const getInboxURL = () => preferences.get({}).mailbox.url || null

app.whenReady().then(async () => {
  const directory = app.getPath('userData')
  preferences = createPreferences(join(directory, 'settings.json'), value => {
    applyTheme(value.theme)
    void i18n.changeLanguage(value.language)
  })
  const initialPreferences = preferences.get({})
  applyTheme(initialPreferences.theme)
  await i18n.changeLanguage(initialPreferences.language)
  const secrets = createSecrets(join(directory, 'secrets.enc'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value)
  })
  backend = createBackend(join(directory, 'database.sqlite'), { settings: preferences, secrets })
  registerDataIPC(backend, join(__dirname, '../renderer/index.html'))
  const created = createMainWindow(getInboxURL)
  browser = created.browser

  app.on('activate', () => {
    if (browserWindowCount() === 0) {
      const next = createMainWindow(getInboxURL)
      browser = next.browser
    }
  })
}).catch(() => {
  // Do not show raw SQLite errors/paths; initialization failure must never silently reset user data.
  dialog.showErrorBox(t($ => $.errors.storageTitle), t($ => $.errors.storageMessage))
  app.quit()
})

app.on('will-quit', () => { backend?.close(); backend = undefined })

ipcMain.handle(BROWSER_NAVIGATE, async (event, input: unknown) => {
  assertTrustedRenderer(event)
  if (typeof input !== 'string') throw new Error(t($ => $.errors.navigationInput))
  await requireBrowser().navigate(input)
})
ipcMain.handle(BROWSER_BACK, (event) => {
  assertTrustedRenderer(event)
  return requireBrowser().back()
})
ipcMain.handle(BROWSER_FORWARD, (event) => {
  assertTrustedRenderer(event)
  return requireBrowser().forward()
})
ipcMain.handle(BROWSER_GET_STATE, (event) => {
  assertTrustedRenderer(event)
  return requireBrowser().getState()
})
ipcMain.handle(BROWSER_SET_VISIBLE, (event, visible: unknown, presentation: unknown) => {
  assertTrustedRenderer(event)
  if (typeof visible !== 'boolean') throw new Error(t($ => $.errors.visibilityInput))
  if (!presentation || typeof presentation !== 'object' ||
    !('tabId' in presentation) || typeof presentation.tabId !== 'string' ||
    !('targetId' in presentation) || typeof presentation.targetId !== 'string') {
    throw new Error(t($ => $.errors.presentationInput))
  }
  requireBrowser().setVisible(visible, { tabId: presentation.tabId, targetId: presentation.targetId })
})

ipcMain.handle(BROWSER_SET_UNSAVED, (event, unsaved: unknown, presentation: unknown) => {
  assertTrustedRenderer(event)
  if (typeof unsaved !== 'boolean' || !presentation || typeof presentation !== 'object' ||
    !('tabId' in presentation) || typeof presentation.tabId !== 'string' || !('targetId' in presentation) || typeof presentation.targetId !== 'string') {
    throw new Error(t($ => $.errors.presentationInput))
  }
  requireBrowser().setUnsaved(unsaved, { tabId: presentation.tabId, targetId: presentation.targetId })
})

ipcMain.handle(BROWSER_CREATE_TAB, (event) => {
  assertTrustedRenderer(event)
  return requireBrowser().createTab()
})
ipcMain.handle(BROWSER_ACTIVATE_TAB, (event, id: unknown) => {
  assertTrustedRenderer(event)
  if (typeof id !== 'string') throw new Error(t($ => $.errors.tabIdInput))
  return requireBrowser().activateTab(id)
})
ipcMain.handle(BROWSER_CLOSE_TAB, (event, id: unknown) => {
  assertTrustedRenderer(event)
  if (typeof id !== 'string') throw new Error(t($ => $.errors.tabIdInput))
  return requireBrowser().closeTab(id)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function requireBrowser(): BrowserManager {
  if (!browser) throw new Error(t($ => $.errors.browserNotReady))
  return browser
}

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  if (!trustedDataSender({ windowOwned: requireBrowser().isTrustedSender(event.sender.id),
    mainFrame: event.senderFrame === event.sender.mainFrame, url: event.senderFrame?.url ?? '' }, expectedURL)) {
    throw new Error(t($ => $.errors.untrustedSender))
  }
}

function getWindows() {
  return BrowserWindow.getAllWindows()
}

function browserWindowCount(): number {
  return getWindows().length
}
