import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { BROWSER_EXTENSIONS_CALL, BROWSER_EXTENSIONS_CHANGED, type ExtensionReply } from '../../../shared/browser-extensions'
import { t } from '../../../shared/i18n'
import { ExtensionImportError } from '../../browser/extension-installer'
import type { BrowserExtensionRuntime } from '../../browser/extensions'
import type { BrowserManager } from '../../browser/browserManager'
import { extensionUUID } from '../../storage/browser-extensions'

const ok = <T>(value: T): ExtensionReply<T> => ({ ok: true, value })

export function registerExtensionIPC(runtime: BrowserExtensionRuntime, browser: () => BrowserManager,
  trust: (event: IpcMainInvokeEvent) => void) {
  ipcMain.handle(BROWSER_EXTENSIONS_CALL, async (event, method: unknown, id: unknown, enabled: unknown) => {
    trust(event)
    try {
      if (method === 'list') return ok(runtime.list())
      if (method === 'importDirectory') {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) return { ok: false, error: 'UNAVAILABLE' }
        const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory'],
          title: t($ => $.extensions.importTitle) })
        if (selection.canceled || !selection.filePaths[0]) return ok(null)
        const path = selection.filePaths[0]
        while (!window.isDestroyed()) {
          const { manifest, fingerprint } = await runtime.installer.inspect(path)
          const confirmation = await dialog.showMessageBox(window, {
            type: 'warning', title: t($ => $.extensions.importTitle),
            message: t($ => $.extensions.confirmImport, { name: manifest.name, version: manifest.version }),
            detail: [
              t($ => $.extensions.permissions, { values: manifest.permissions.join(', ') || t($ => $.extensions.none) }),
              t($ => $.extensions.sites, { values: manifest.sites.join(', ') || t($ => $.extensions.none) }),
              t($ => $.extensions.scope)
            ].join('\n'),
            buttons: [t($ => $.settings.cancel), t($ => $.extensions.importAndEnable)],
            defaultId: 0, cancelId: 0, noLink: true
          })
          if (confirmation.response !== 1 || window.isDestroyed()) return ok(null)
          try { await runtime.importDirectory(path, fingerprint); break }
          catch (error) { if (!(error instanceof ExtensionImportError && error.code === 'SOURCE_CHANGED')) throw error }
        }
        return ok(null)
      }
      if (typeof id !== 'string' || !extensionUUID.test(id)) return { ok: false, error: 'UNAVAILABLE' }
      if (method === 'setEnabled' && typeof enabled === 'boolean') await runtime.setEnabled(id, enabled)
      else if (method === 'remove') await runtime.remove(id)
      else if (method === 'openOptions') await runtime.openOptions(id, target => browser().openExtensionOptions(target))
      else return { ok: false, error: 'UNAVAILABLE' }
      return ok(null)
    } catch (error) {
      return { ok: false, error: error instanceof ExtensionImportError ? error.code : 'UNAVAILABLE' }
    }
  })
}

export function publishExtensionChange() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(BROWSER_EXTENSIONS_CHANGED)
  }
}
