export interface BrowserState {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface BrowserAPI {
  navigate(input: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  getState(): Promise<BrowserState>
  onStateChange(callback: (state: BrowserState) => void): () => void
}

export const BROWSER_STATE_CHANGED = 'browser:state-changed'
export const BROWSER_NAVIGATE = 'browser:navigate'
export const BROWSER_BACK = 'browser:back'
export const BROWSER_FORWARD = 'browser:forward'
export const BROWSER_GET_STATE = 'browser:get-state'

export const TOOLBAR_HEIGHT = 64
