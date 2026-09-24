import type { BrowserAPI } from '../shared/browser'

declare global {
  interface Window {
    browser: BrowserAPI
  }
}

export {}
