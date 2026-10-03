import type { BrowserAPI } from '../shared/browser'
import type { DataAPI } from '../platform/electron/data-contract'

declare global {
  interface Window {
    browser: BrowserAPI
    data: DataAPI
  }
}

export {}
