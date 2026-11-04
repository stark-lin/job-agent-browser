import { historyIndicatorStyles } from './history-indicator-styles'

/** Scriptless central primitive for the native overlay above website content. */
export function historyIndicatorDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>History indicator</title><style>${historyIndicatorStyles}
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { display: grid; place-items: center; }
</style></head><body><span class="ui-history-indicator" role="img">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18"/></svg>
</span></body></html>`
}
