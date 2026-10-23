import { t, i18n } from '../../../shared/i18n'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { createPreferences } from '../../storage/preferences'
import { createSecrets } from '../../storage/secrets'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBackend } from '../../database/backend'
import { trustedDataSender, registerDataIPC } from './data-ipc'
import { createAIService, type AIService } from '../../ai'
import { registerAIIPC } from './ai-ipc'
import { createProfileImporter, type ProfileImporter } from '../../profile-import/service'
import { registerProfileImportIPC } from './profile-import-ipc'
import { createResumeTasks, type ResumeTasks } from '../../agent/resume-tasks'
import { registerResumeIPC } from './resume-ipc'
import { createJobImporter, type JobImporter } from '../../job-import/service'
import { createURLReader } from '../../job-import/url-reader'
import { registerJobImportIPC } from './job-import-ipc'
import type { ImportSaved } from '../../../domain/candidate/import.types'
import type { Result } from '../../../shared/ipc'
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
import { createToolRuntime, type ToolRuntime } from '../../mcp/runtime'
import { readMCPConfiguration } from '../../storage/mcp-config'

let browser: BrowserManager | undefined
let backend: ReturnType<typeof createBackend> | undefined
let preferences: ReturnType<typeof createPreferences>
let ai: AIService | undefined
let profileImporter: ProfileImporter | undefined
let jobImporter: JobImporter | undefined
let tools: ToolRuntime | undefined
let resumes: ResumeTasks | undefined
let shuttingDown = false
const getInboxURL = () => preferences.get({}).mailbox.url || null

if (process.env.JOB_BROWSER_USER_DATA) app.setPath('userData', process.env.JOB_BROWSER_USER_DATA)

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
  tools = createToolRuntime({ configuration: () => readMCPConfiguration(join(directory, 'mcp.json')), capabilities: backend.capabilities,
    native: backend.toolCapabilities.read, recoverAudit: backend.toolAudit.recoverInterrupted })
  // Optional external capabilities never delay window creation or reject the application startup.
  void tools.start()
  ai = createAIService({ settings: () => preferences.get({}).ai, key: secrets.readProviderKey, audit: backend.recordAI })
  profileImporter = createProfileImporter({ ai, apply: input => backend!.dispatch('profiles', 'applyImport', input) as Result<ImportSaved> })
  jobImporter = createJobImporter({ ai, reader: createURLReader() })
  resumes = createResumeTasks({ backend, settings: () => preferences.get({}).ai, key: secrets.readProviderKey,
    directory: join(directory, 'artifacts'), fonts: join(__dirname, 'fonts') })
  registerResumeIPC(resumes, join(__dirname, '../renderer/index.html'))
  registerDataIPC(backend, join(__dirname, '../renderer/index.html'), profileImporter)
  registerProfileImportIPC(profileImporter, join(__dirname, '../renderer/index.html'))
  registerAIIPC(ai, join(__dirname, '../renderer/index.html'))
  registerJobImportIPC(jobImporter, join(__dirname, '../renderer/index.html'))
  app.on('web-contents-created', (_event, contents) => {
    const owner = contents.id
    const disposeOwner = () => { ai?.disposeOwner(owner); profileImporter?.disposeOwner(owner); jobImporter?.disposeOwner(owner); resumes?.disposeOwner(owner) }
    contents.on('destroyed', disposeOwner)
    contents.on('render-process-gone', disposeOwner)
    contents.on('did-navigate', disposeOwner)
  })
  const created = createMainWindow(getInboxURL)
  browser = created.browser

  app.on('activate', () => {
    if (browserWindowCount() === 0) {
      const next = createMainWindow(getInboxURL)
      browser = next.browser
    }
  })
}).catch((error: unknown) => {
  // Do not show raw SQLite errors/paths; initialization failure must never silently reset user data.
  dialog.showErrorBox(t($ => $.errors.storageTitle), error instanceof Error && error.message.startsWith('INCOMPATIBLE_DATABASE_GENERATION') ? t($ => $.errors.databaseGeneration) : t($ => $.errors.storageMessage))
  app.quit()
})

app.on('will-quit', event => {
  profileImporter?.dispose()
  jobImporter?.dispose()
  // Windows have already passed their unsaved-settings guards at this point.
  if (shuttingDown) return
  if (!ai && !tools && !resumes) { backend?.close(); backend = undefined; return }
  event.preventDefault(); shuttingDown = true
  void Promise.allSettled([ai?.dispose(), tools?.dispose(), resumes?.dispose()]).finally(() => { backend?.close(); backend = undefined; app.quit() })
})

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
