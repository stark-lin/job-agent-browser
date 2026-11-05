import { ipcRenderer } from 'electron'
import { BROWSER_EXTENSIONS_CALL, BROWSER_EXTENSIONS_CHANGED, type BrowserExtensionsAPI } from '../../../shared/browser-extensions'

export function createExtensionBridge(): BrowserExtensionsAPI {
  return {
    list: () => ipcRenderer.invoke(BROWSER_EXTENSIONS_CALL, 'list'),
    importDirectory: () => ipcRenderer.invoke(BROWSER_EXTENSIONS_CALL, 'importDirectory'),
    setEnabled: (id, enabled) => ipcRenderer.invoke(BROWSER_EXTENSIONS_CALL, 'setEnabled', id, enabled),
    remove: id => ipcRenderer.invoke(BROWSER_EXTENSIONS_CALL, 'remove', id),
    openOptions: id => ipcRenderer.invoke(BROWSER_EXTENSIONS_CALL, 'openOptions', id),
    onChanged(callback) {
      const listener = () => callback()
      ipcRenderer.on(BROWSER_EXTENSIONS_CHANGED, listener)
      return () => ipcRenderer.removeListener(BROWSER_EXTENSIONS_CHANGED, listener)
    }
  }
}
