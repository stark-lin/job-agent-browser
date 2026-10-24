import type { AskAgentAPI } from '../../platform/electron/ask-agent-contract'
import type { DataAPI } from '../../platform/electron/data-contract'
import type { AgentRunEvent, ChatChoice, ChatItem, ChatRun, ChatSession, ChatSnapshot } from '../../domain/chat/chat.types'

export interface AskState {
  sessions: ChatSession[]; total: number; activeId: string | null; items: Record<string, ChatItem[]>; runs: Record<string, ChatRun[]>
  drafts: Record<string, string>; choices: Record<string, ChatChoice | null>; totals: Record<string, number>; loading: boolean; sending: boolean; error: string | null
}
/** App lifetime projection: page unmount only unsubscribes React, never stops Main work. */
export class AskStore {
  private state: AskState = { sessions: [], total: 0, activeId: null, items: {}, runs: {}, drafts: {}, choices: {}, totals: {}, loading: true, sending: false, error: null }
  private listeners = new Set<() => void>()
  private snapshots = new Map<string, ChatSnapshot>()
  private pending = new Map<string, AgentRunEvent[]>()
  private syncing = new Set<string>()
  private cancelled = false
  private refreshing?: Promise<void>
  private unlisten?: () => void
  private request?: { id: string; key: string; message: string; choice: ChatChoice }
  readonly scroll = new Map<string, number>()
  constructor(private readonly api: AskAgentAPI, private readonly data: DataAPI) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private change(patch: Partial<AskState>) {
    if (this.cancelled) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  error = (error: string | null) => this.change({ error })
  start() {
    this.cancelled = false; this.unlisten = this.api.onEvent(event => this.receive(event))
    void this.initialize().catch(() => this.error('STORAGE_UNAVAILABLE')).finally(() => this.change({ loading: false }))
    return () => { this.cancelled = true; this.unlisten?.() }
  }
  private async initialize() {
    await this.refreshSessions()
    const active = await this.api.listActive({})
    if (!active.ok) this.error(active.error)
    else for (const snapshot of active.value) this.project(snapshot)
  }
  async refreshSessions(more = false) {
    if (!more && this.refreshing) return this.refreshing
    const operation = this.fetchSessions(more)
    if (!more) this.refreshing = operation
    try { await operation } finally { if (!more) this.refreshing = undefined }
  }
  private async fetchSessions(more: boolean) {
    const result = await this.data.chats.listSessions({ limit: 50, offset: more ? this.state.sessions.length : 0 })
    if (!result.ok) { this.error(result.error); return }
    this.change({ sessions: more ? [...new Map([...this.state.sessions, ...result.value.items].map(s => [s.id, s])).values()] : result.value.items, total: result.value.total })
  }
  select = (id: string | null) => { const session = this.state.sessions.find(s => s.id === id); this.change({ activeId: id, error: null, choices: session ? { ...this.state.choices, [session.id]: this.state.choices[session.id] ?? { providerId: session.providerId, modelId: session.modelId } } : this.state.choices }); if (id) void this.load(id).catch(() => this.error('STORAGE_UNAVAILABLE')) }
  setDraft = (text: string) => { const key = this.state.activeId ?? 'draft'; this.change({ drafts: { ...this.state.drafts, [key]: text } }) }
  async setChoice(choice: ChatChoice | null) {
    const key = this.state.activeId ?? 'draft'
    if (this.state.activeId && choice) {
      const result = await this.data.chats.setModel({ id: key, choice })
      if (!result.ok) { this.error(result.error); return }
      this.change({ sessions: this.state.sessions.map(s => s.id === key ? result.value : s) })
    }
    this.change({ choices: { ...this.state.choices, [key]: choice } })
  }
  async load(id: string, older = false) {
    const current = this.state.items[id] ?? [], beforeSequence = older ? current[0]?.sequence : undefined
    const [items, runs] = await Promise.all([this.data.chats.listItems({ sessionId: id, limit: 50, beforeSequence }), this.data.chats.listRuns({ sessionId: id, limit: 100 })])
    if (!items.ok || !runs.ok) { this.error(!items.ok ? items.error : !runs.ok ? runs.error : 'STORAGE_UNAVAILABLE'); return }
    const knownRuns = [...(this.state.runs[id] ?? []), ...runs.value.items]
    const missingRuns = [...new Set(items.value.items.map(i => i.runId))].filter(runId => !knownRuns.some(r => r.id === runId))
    for (const runId of missingRuns) {
      const result = await this.data.chats.getRun({ id: runId })
      if (result.ok) knownRuns.push(result.value)
    }
    const liveItems = [...this.snapshots.values()].filter(s => s.run.sessionId === id).flatMap(s => s.items)
    const combined = [...(older ? current : []), ...items.value.items, ...liveItems]
    const liveRuns = [...this.snapshots.values()].filter(s => s.run.sessionId === id).map(s => s.run)
    this.change({ items: { ...this.state.items, [id]: [...new Map(combined.map(i => [i.id, i])).values()].sort((a, b) => a.sequence - b.sequence) },
      totals: { ...this.state.totals, [id]: items.value.total }, runs: { ...this.state.runs, [id]: [...new Map([...knownRuns, ...liveRuns].map(r => [r.id, r])).values()] } })
    for (const r of runs.value.items) if (r.state === 'running') void this.sync(r.id)
  }
  private project(snapshot: ChatSnapshot) {
    const old = this.snapshots.get(snapshot.run.id)
    if (old && old.run.eventSequence > snapshot.run.eventSequence) return
    this.snapshots.set(snapshot.run.id, snapshot)
    if (!this.state.sessions.some(s => s.id === snapshot.run.sessionId)) void this.refreshSessions().catch(() => this.error('STORAGE_UNAVAILABLE'))
    const id = snapshot.run.sessionId
    this.change({ items: { ...this.state.items, [id]: [...new Map([...(this.state.items[id] ?? []), ...snapshot.items].map(i => [i.id, i])).values()].sort((a, b) => a.sequence - b.sequence) },
      runs: { ...this.state.runs, [id]: [...(this.state.runs[id] ?? []).filter(r => r.id !== snapshot.run.id), snapshot.run] } })
  }
  private receive(event: AgentRunEvent) {
    if (this.cancelled) return
    const snapshot = this.snapshots.get(event.runId)
    if (snapshot && event.eventSequence <= snapshot.run.eventSequence) return
    if (this.syncing.has(event.runId) || !snapshot || event.eventSequence !== snapshot.run.eventSequence + 1) {
      const queued = this.pending.get(event.runId) ?? []; queued.push(event); this.pending.set(event.runId, queued.slice(-2048)); void this.sync(event.runId); return
    }
    const next = { run: { ...snapshot.run, eventSequence: event.eventSequence }, items: snapshot.items }
    if (event.type === 'item.delta') {
      const item = next.items.find(i => i.id === event.itemId)
      if (!item || item.content.type === 'tool_call') { void this.sync(event.runId); return }
      const updated: ChatItem = { ...item, content: { ...item.content, text: item.content.text + event.delta } }
      next.items = next.items.map(i => i.id === item.id ? updated : i)
    } else if ('item' in event) next.items = [...next.items.filter(i => i.id !== event.item.id), event.item].sort((a, b) => a.sequence - b.sequence)
    else next.run = { ...event.run, eventSequence: event.eventSequence }
    this.project(next)
    if (event.type.startsWith('run.')) void this.refreshSessions().catch(() => this.error('STORAGE_UNAVAILABLE'))
  }
  async sync(id: string) {
    if (this.syncing.has(id) || this.cancelled) return
    this.syncing.add(id)
    let synchronized = false
    try {
      const result = await this.api.getRun({ runId: id })
      if (!result.ok) { this.error(result.error); return }
      this.project(result.value); synchronized = true
    } catch { this.error('STORAGE_UNAVAILABLE') }
    finally {
      this.syncing.delete(id)
      const queued = this.pending.get(id) ?? []; this.pending.delete(id)
      if (!synchronized) return
      for (const event of queued.sort((a, b) => a.eventSequence - b.eventSequence)) this.receive(event)
    }
  }
  async send(choice: ChatChoice, retry?: string) {
    if (this.state.sending) return
    const key = this.state.activeId ?? 'draft', message = retry ?? this.state.drafts[key] ?? ''
    if (!message.trim() || this.state.runs[key]?.some(r => r.state === 'running')) return
    if (!this.request || this.request.key !== key || this.request.message !== message || JSON.stringify(this.request.choice) !== JSON.stringify(choice)) this.request = { id: crypto.randomUUID(), key, message, choice }
    this.change({ sending: true, error: null })
    try {
      const result = await this.api.start({ requestId: this.request.id, sessionId: this.state.activeId ?? undefined, message, choice })
      if (!result.ok) { this.error(result.error); return }
      this.request = undefined
      const drafts = { ...this.state.drafts, [key]: this.state.drafts[key] === message ? '' : this.state.drafts[key] ?? '' }
      if (result.value.sessionId !== key) drafts[result.value.sessionId] = ''
      this.change({ activeId: (this.state.activeId ?? 'draft') === key ? result.value.sessionId : this.state.activeId, drafts, choices: { ...this.state.choices, [result.value.sessionId]: choice } })
      await Promise.all([this.sync(result.value.runId), this.refreshSessions()])
    } catch { this.error('STORAGE_UNAVAILABLE') }
    finally { this.change({ sending: false }) }
  }
  async stop(runId: string) { const result = await this.api.cancel({ runId }); if (!result.ok) this.error(result.error) }
  async rename(id: string, title: string) { const result = await this.data.chats.renameSession({ id, title }); if (!result.ok) this.error(result.error); else await this.refreshSessions() }
  async remove(id: string) {
    const result = await this.data.chats.deleteSession({ id })
    if (!result.ok) { this.error(result.error); return }
    for (const [runId, snapshot] of this.snapshots) if (snapshot.run.sessionId === id) this.snapshots.delete(runId)
    const items = { ...this.state.items }, runs = { ...this.state.runs }, drafts = { ...this.state.drafts }, choices = { ...this.state.choices }, totals = { ...this.state.totals }
    delete items[id]; delete runs[id]; delete drafts[id]; delete choices[id]; delete totals[id]; this.scroll.delete(id)
    this.change({ items, runs, drafts, choices, totals })
    if (this.state.activeId === id) this.select(null)
    await this.refreshSessions()
  }
}
