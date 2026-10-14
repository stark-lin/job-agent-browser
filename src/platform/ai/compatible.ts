import { fail } from '../../domain/common/errors'
import type { AIMessage, AIProvider } from '../../shared/ai'

export type Fetch = typeof fetch
export interface ChatRequest { provider: AIProvider; model: string; key: string | null; messages: AIMessage[] }

/** Parse SSE frames independently of network chunks, including split UTF-8 and CRLF. */
export async function streamChat(request: ChatRequest, signal: AbortSignal, onStart: () => void, onText: (text: string) => void, transport: Fetch = fetch): Promise<void> {
  const response = await transport(`${request.provider.baseURL}/chat/completions`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(request.key ? { Authorization: `Bearer ${request.key}` } : {}) },
    body: JSON.stringify({ model: request.model, messages: request.messages, stream: true })
  })
  if (!response.ok) {
    await response.body?.cancel()
    return fail(response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED')
  }
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel()
    return fail('AI_PROTOCOL_ERROR')
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', data: string[] = [], began = false, finished = false, outputLength = 0
  function frame(): boolean {
    if (!data.length) return false
    const payload = data.join('\n'); data = []
    if (payload === '[DONE]') {
      if (!began || !finished) return fail('AI_PROTOCOL_ERROR')
      return true
    }
    let value: unknown
    try { value = JSON.parse(payload) } catch { return fail('AI_PROTOCOL_ERROR') }
    if (!value || typeof value !== 'object') return fail('AI_PROTOCOL_ERROR')
    if ('error' in value) return fail('AI_PROVIDER_FAILED')
    if (!('choices' in value) || !Array.isArray(value.choices)) return fail('AI_PROTOCOL_ERROR')
    if (!value.choices.length) return false // Optional usage-only frame.
    const choice: unknown = value.choices[0]
    if (!choice || typeof choice !== 'object' || !('delta' in choice) || !choice.delta || typeof choice.delta !== 'object') return fail('AI_PROTOCOL_ERROR')
    const delta = choice.delta as Record<string, unknown>
    if (delta.tool_calls || delta.function_call || (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string')) return fail('AI_PROTOCOL_ERROR')
    if (delta.role !== undefined && delta.role !== 'assistant') return fail('AI_PROTOCOL_ERROR')
    if (!delta.role && !delta.content && (!('finish_reason' in choice) || choice.finish_reason === null)) return false
    if (!began) { onStart(); began = true }
    if (typeof delta.content === 'string' && delta.content) {
      outputLength += delta.content.length
      if (outputLength > 1000000) return fail('AI_PROTOCOL_ERROR')
      onText(delta.content)
    }
    if ('finish_reason' in choice && choice.finish_reason !== null && choice.finish_reason !== undefined) {
      if (choice.finish_reason !== 'stop') return fail('AI_PROVIDER_FAILED')
      finished = true
    }
    return false
  }
  function lines(eof: boolean): boolean {
    let match: RegExpExecArray | null
    while ((match = /\r\n|\n|\r/.exec(buffer))) {
      if (!eof && match[0] === '\r' && match.index === buffer.length - 1) break
      const line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
      if (!line) { if (frame()) return true }
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      if (buffer.length + data.reduce((n, text) => n + text.length, 0) > 262144) return fail('AI_PROTOCOL_ERROR')
    }
    return false
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      try { buffer += decoder.decode(chunk.value, { stream: !chunk.done }) } catch { return fail('AI_PROTOCOL_ERROR') }
      if (buffer.length > 524288) return fail('AI_PROTOCOL_ERROR')
      if (lines(chunk.done)) return
      if (chunk.done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''))
        frame()
        if (!began || !finished) return fail('AI_PROTOCOL_ERROR')
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
