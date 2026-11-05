export const BROWSER_EXTENSIONS_CALL = 'browser-extensions:call'
export const BROWSER_EXTENSIONS_CHANGED = 'browser-extensions:changed'

export interface ExtensionManifestInfo {
  name: string
  version: string
  permissions: string[]
  sites: string[]
  optionsPath: string | null
}

export interface ExtensionSummary {
  id: string
  name: string
  version: string
  source: 'manual' | 'mcp'
  enabled: boolean
  pendingRemoval?: true
}

export interface ExtensionView extends ExtensionSummary {
  status: 'DISABLED' | 'LOADING' | 'RUNNING' | 'FAILED' | 'PENDING_REMOVAL'
  canOpenOptions: boolean
  permissions: string[]
  sites: string[]
  cleanupFailed: boolean
}

export type ExtensionInstallResult =
  | { status: 'INSTALLED_DISABLED'; extensionId: string; name: string; version: string; enabled: false; requiresUserAction: true; nextAction: 'ENABLE_IN_SETTINGS' }
  | { status: 'ALREADY_INSTALLED'; extensionId: string; name: string; version: string; enabled: boolean }
  | { status: 'PENDING_REMOVAL' | 'REQUEST_CONFLICT' | 'REQUEST_STALE' | 'INVALID_PATH' | 'INVALID_MANIFEST' | 'INSTALL_FAILED' }

export type ExtensionError = 'INVALID_PATH' | 'INVALID_MANIFEST' | 'INSTALL_FAILED' | 'ALREADY_INSTALLED' | 'PENDING_REMOVAL' | 'SOURCE_CHANGED' | 'UNAVAILABLE'
export type ExtensionReply<T> = { ok: true; value: T } | { ok: false; error: ExtensionError }

export interface BrowserExtensionsAPI {
  list(): Promise<ExtensionReply<ExtensionView[]>>
  importDirectory(): Promise<ExtensionReply<null>>
  setEnabled(id: string, enabled: boolean): Promise<ExtensionReply<null>>
  remove(id: string): Promise<ExtensionReply<null>>
  openOptions(id: string): Promise<ExtensionReply<null>>
  onChanged(callback: () => void): () => void
}
