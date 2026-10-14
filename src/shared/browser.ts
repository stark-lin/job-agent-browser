import type { Destination } from './navigation'
import type { ResolvedTheme } from './settings'

export interface Presentation {
  tabId: string
  targetId: string
}

export interface BrowserTabState {
  id: string
  title: string
  url: string
  destination: Destination
  targetId: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  error: string
}

export interface BrowserState {
  language?: 'en' | 'zh-CN'
  theme?: ResolvedTheme
  revision: number
  tabs: BrowserTabState[]
  activeTabId: string
}

export interface BrowserAPI {
  setUnsaved(unsaved: boolean, presentation: Presentation): Promise<void>
  setVisible(visible: boolean, presentation: Presentation): Promise<void>
  navigate(input: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  createTab(): Promise<void>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  getState(): Promise<BrowserState>
  onStateChange(callback: (state: BrowserState) => void): () => void
  onFocusAddress(callback: () => void): () => void
}

export const BROWSER_STATE_CHANGED = 'browser:state-changed'
export const BROWSER_NAVIGATE = 'browser:navigate'
export const BROWSER_BACK = 'browser:back'
export const BROWSER_FORWARD = 'browser:forward'
export const BROWSER_GET_STATE = 'browser:get-state'
export const BROWSER_SET_VISIBLE = 'browser:set-visible'
export const BROWSER_SET_UNSAVED = 'browser:set-unsaved'
export const BROWSER_CREATE_TAB = 'browser:create-tab'
export const BROWSER_ACTIVATE_TAB = 'browser:activate-tab'
export const BROWSER_CLOSE_TAB = 'browser:close-tab'
export const BROWSER_FOCUS_ADDRESS = 'browser:focus-address'

export { TAB_STRIP_HEIGHT, TOOLBAR_HEIGHT, BROWSER_CHROME_HEIGHT, getSidebarWidth } from './ui/geometry'
