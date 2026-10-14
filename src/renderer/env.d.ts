import type { BrowserAPI } from '../shared/browser'
import type { DataAPI } from '../platform/electron/data-contract'
import type { AIAPI } from '../shared/ai'

declare global {
  interface Window {
    browser: BrowserAPI
    data: DataAPI
    ai: AIAPI
  }
}

export {}
