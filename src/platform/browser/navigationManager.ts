import { t } from '../../shared/i18n'
import { parseInternalURL, type Destination } from '../../shared/navigation'

export function resolveDestination(input: string): Destination {
  return /^app:/i.test(input.trim())
    ? parseInternalURL(input)
    : { kind: 'web', url: resolveNavigationInput(input) }
}

const SEARCH_URL = 'https://www.google.com/search?q='

export function resolveNavigationInput(input: string): string {
  const value = input.trim()
  if (!value) throw new Error(t($ => $.errors.emptyAddress))

  // Host:port syntax must be distinguished from an explicit protocol.
  const hostWithPort = /^(?:localhost|[^\s/:?#]+\.[^\s/:?#]+):\d+(?:[/?#]|$)/i.test(value)
  if (!hostWithPort && /^[a-z][a-z\d+.-]*:/i.test(value)) {
    if (!/^https?:/i.test(value)) throw new Error(t($ => $.errors.unsupportedProtocol))
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(t($ => $.errors.invalidAddress))
    }
    if (!url.hostname) throw new Error(t($ => $.errors.invalidAddress))
    return url.toString()
  }

  if (!/\s/.test(value)) {
    try {
      const url = new URL(`https://${value}`)
      // Email addresses and single words are search terms, even if URL accepts them.
      if (!url.username && !url.password && isHost(url.hostname, value)) {
        const host = url.hostname.toLowerCase()
        if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) {
          url.protocol = 'http:'
        }
        return url.toString()
      }
    } catch {
      // Invalid bare addresses are useful search queries too.
    }
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`
}

function isHost(hostname: string, input: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || /^\[.*\]$/.test(host)) return true
  // URL normalizes a numeric word such as "2026" to an IPv4 address; keep it a search.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(input)
  }
  const labels = host.split('.')
  return labels.length > 1 && labels.every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(label))
    && /^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/.test(labels.at(-1) ?? '')
}
