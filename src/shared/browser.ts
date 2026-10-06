import type { Destination } from './navigation'

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
  revision: number
  tabs: BrowserTabState[]
  activeTabId: string
}

export interface BrowserAPI {
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
export const BROWSER_CREATE_TAB = 'browser:create-tab'
export const BROWSER_ACTIVATE_TAB = 'browser:activate-tab'
export const BROWSER_CLOSE_TAB = 'browser:close-tab'
export const BROWSER_FOCUS_ADDRESS = 'browser:focus-address'

export const TAB_STRIP_HEIGHT = 44
export const TOOLBAR_HEIGHT = 64
export const BROWSER_CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT
