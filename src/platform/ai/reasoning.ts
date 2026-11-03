import type { ProviderReasoning, ReasoningInfo } from '../../shared/agent'
import { AgentError } from '../../shared/agent'
const protocol: () => never = () => { throw new AgentError('AGENT_PROTOCOL_ERROR') }

const scalarSources = ['reasoning_content', 'reasoning', 'reasoning_summary'] as const
type Channel = { source: string; kind: string; text: string; shown: { text: string } }
/** Accumulates wire state separately from the display projection (including mirrored fields). */
export class ReasoningAccumulator {
  readonly state: ProviderReasoning = {}
  private details = new Map<string, Record<string, unknown>>()
  private channels: Channel[] = []
  private encrypted = new Set<string>()
  bytes = 0
  read(delta: Record<string, unknown>): { text: string; reasoning: ReasoningInfo }[] {
    const output: { text: string; reasoning: ReasoningInfo }[] = []
    const emit = (text: string, reasoning: ReasoningInfo) => {
      let channel = this.channels.find(c => c.source === reasoning.source && c.kind === reasoning.kind)
      if (!channel) { channel = { source: reasoning.source, kind: reasoning.kind, text: '', shown: { text: '' } }; this.channels.push(channel) }
      channel.text += text
      const mirror = this.channels.find(c => c !== channel && c.kind === channel.kind && c.source !== channel.source && c.text
        && (c.text.startsWith(channel.text) || channel.text.startsWith(c.text)))
      if (mirror) channel.shown = mirror.shown
      if (channel.shown.text.startsWith(channel.text)) return
      const next = channel.text.startsWith(channel.shown.text) ? channel.text.slice(channel.shown.text.length) : text
      channel.shown.text = channel.text
      if (next) output.push({ text: next, reasoning })
    }
    // Structured blocks are canonical when aliases arrive in the same frame.
    if (delta.reasoning_details !== undefined && delta.reasoning_details !== null) {
      if (!Array.isArray(delta.reasoning_details)) protocol()
      this.bytes += Buffer.byteLength(JSON.stringify(delta.reasoning_details))
      delta.reasoning_details.forEach((raw: unknown, position: number) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) protocol()
        const part = raw as Record<string, unknown>
        for (const field of ['type', 'id', 'format', 'text', 'summary', 'data', 'signature']) {
          if (part[field] !== undefined && part[field] !== null && typeof part[field] !== 'string') protocol()
        }
        if (part.index !== undefined && (!Number.isSafeInteger(part.index) || Number(part.index) < 0)) protocol()
        const key = String(part.index ?? part.id ?? position), old = this.details.get(key) ?? {}
        const merged = { ...old, ...part }
        for (const field of ['text', 'summary', 'data', 'signature']) if (typeof part[field] === 'string') merged[field] = String(old[field] ?? '') + part[field]
        this.details.set(key, merged)
        const source = 'reasoning_details', blockId = key
        if (merged.type === 'reasoning.encrypted' && !this.encrypted.has(key)) {
          this.encrypted.add(key); output.push({ text: '', reasoning: { source, blockId, kind: 'encrypted' } })
        }
        if (merged.type !== 'reasoning.encrypted') {
          if (typeof part.text === 'string') emit(part.text, { source, blockId, kind: 'text' })
          if (typeof part.summary === 'string') emit(part.summary, { source, blockId, kind: 'summary' })
        }
      })
      this.state.reasoning_details = [...this.details.values()]
    }
    for (const source of scalarSources) {
      const text = delta[source]
      if (text !== undefined && text !== null && typeof text !== 'string') protocol()
      if (typeof text !== 'string') continue
      this.bytes += Buffer.byteLength(text)
      this.state[source] = (this.state[source] ?? '') + text
      if (text) emit(text, { source, kind: source === 'reasoning_summary' ? 'summary' : 'text' })
    }
    return output
  }
}
