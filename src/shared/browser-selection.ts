export type SelectionTarget = 'ask-ai' | 'job-import'
export interface WebSelection {
  id: string
  target: SelectionTarget
  text: string
  source: { url: string; title: string }
}

export const SELECTION_TEXT_LIMIT = 60_000
export const ASK_MESSAGE_LIMIT = 128_000
const authenticationParameters = new Set(['token', 'access_token', 'refresh_token', 'id_token', 'authorization', 'auth', 'api_key', 'apikey', 'password', 'secret', 'sessionid', 'sid', 'signature', 'sig', 'code', 'state'])

/** Only metadata is sanitized; the selected text remains ordinary user input. */
export function selectionContent(text: string, url: string, title: string): Pick<WebSelection, 'text' | 'source'> {
  if (!text.trim() || text.includes('\0') || text.length > SELECTION_TEXT_LIMIT) throw new Error('INVALID_SELECTION')
  if (url.length > 4096 || title.length > 1000 || title.includes('\0') || url.includes('\0')) throw new Error('INVALID_SELECTION')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('INVALID_SELECTION') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_SELECTION')
  parsed.username = ''; parsed.password = ''; parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    const name = key.toLowerCase()
    if (authenticationParameters.has(name) || name.startsWith('x-amz-') || name.startsWith('x-goog-')) parsed.searchParams.delete(key)
  }
  if (parsed.href.length > 4096) throw new Error('INVALID_SELECTION')
  return { text, source: { url: parsed.href, title } }
}

export function selectionQuote(selection: WebSelection, labels: { source: string; content: string }): string {
  return `${labels.source}: ${selection.source.title}\n${selection.source.url}\n\n${labels.content}:\n${selection.text.split(/\r?\n/).map(line => `> ${line}`).join('\n')}`
}
