import { AgentError, abortable } from '../../shared/agent'

/** Chunk-independent UTF-8 SSE framing with strict, bounded JSON payloads. */
export async function* sseFrames(response: Response, signal: AbortSignal): AsyncIterable<unknown> {
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel(); throw new AgentError('AGENT_PROTOCOL_ERROR')
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', data: string[] = [], total = 0
  const parse = (text: string): unknown => {
    if (text === '[DONE]') return text
    try { return JSON.parse(text) } catch { throw new AgentError('AGENT_PROTOCOL_ERROR') }
  }
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal)
      total += part.value?.length ?? 0
      if (total > 2097152) throw new AgentError('AGENT_PROTOCOL_ERROR')
      buffer += decoder.decode(part.value, { stream: !part.done })
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer)
        if (!match || !part.done && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
        if (!line && data.length) { yield parse(data.join('\n')); data = [] }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        if (buffer.length + data.reduce((n, value) => n + value.length, 0) > 524288) throw new AgentError('AGENT_PROTOCOL_ERROR')
      }
      if (buffer.length > 524288) throw new AgentError('AGENT_PROTOCOL_ERROR')
      if (part.done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''))
        if (data.length) yield parse(data.join('\n'))
        break
      }
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
