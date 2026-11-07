import { bannerStyles } from './banner-styles'

export function bannerDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Banner</title><style>${bannerStyles}
html, body { margin: 0; overflow: hidden; background: transparent; }
</style></head><body><aside class="ui-banner">
<button type="button" class="ui-banner-body" aria-disabled="true" tabindex="-1">
<span class="ui-banner-title"></span><span class="ui-banner-detail" aria-live="polite"></span></button>
<button type="button" class="ui-banner-close">×</button></aside></body></html>`
}
