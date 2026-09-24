import type { WebContents } from 'electron'

const SEARCH_URL = 'https://www.google.com/search?q='

export function resolveNavigationInput(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('Enter a URL or search term.')

  if (/\s/.test(value)) {
    return `${SEARCH_URL}${encodeURIComponent(value)}`
  }

  // Treat an explicit URL scheme as intentional, then enforce the web-only policy.
  const looksLikeHost = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:\/|$)/i.test(value)
  const hasScheme = !looksLikeHost && /^[a-z][a-z\d+.-]*:/i.test(value)
  const candidate = hasScheme ? value : `https://${value}`
  let url: URL

  try {
    url = new URL(candidate)
  } catch {
    return `${SEARCH_URL}${encodeURIComponent(value)}`
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS pages can be opened.')
  }
  if (!url.hostname) throw new Error('Enter a valid web address.')

  return url.toString()
}

export class NavigationController {
  constructor(private readonly contents: WebContents) {}

  async navigate(input: string): Promise<void> {
    await this.contents.loadURL(resolveNavigationInput(input))
  }

  back(): void {
    if (this.contents.navigationHistory.canGoBack()) {
      this.contents.navigationHistory.goBack()
    }
  }

  forward(): void {
    if (this.contents.navigationHistory.canGoForward()) {
      this.contents.navigationHistory.goForward()
    }
  }
}
