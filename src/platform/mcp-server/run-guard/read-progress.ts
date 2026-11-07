import type { JsonValue, ToolDescriptor, ToolOutput } from '../../../shared/tools/tool.types'
import { callDigest } from '../../mcp/call-fingerprint'

const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
type Coverage = { full: boolean; ranges: [number, number][] }
const lists: Record<string, string> = {
  'job.list': 'job', 'profile.list': 'profile', 'profile.list_items': 'item', 'profile.list_facts': 'fact',
  'application.list_events': 'event', 'resume.list_facts': 'snapshot-fact', 'resume.list_bullets': 'resume-bullet'
}

/** Run-local evidence, never persisted. Known collections are sets; unknown arrays retain their meaning. */
export class ReadProgress {
  private seen = new Set<string>()
  private files = new Map<string, Coverage>()
  private add(value: unknown) {
    const key = callDigest(value), fresh = !this.seen.has(key)
    this.seen.add(key)
    return fresh
  }
  private entity(kind: string, value: unknown, identity?: unknown): boolean {
    const row = object(value)
    if (!row) return this.add([kind, value])
    const id = row.id ?? row.bulletId ?? identity
    if (typeof id !== 'string') return this.add([kind, row])
    let fresh = this.add(['entity', kind, id])
    for (const [field, content] of Object.entries(row)) {
      // Business dates (e.g. appliedAt/startsAt) remain evidence; bookkeeping dates do not.
      if (['id', 'createdAt', 'updatedAt'].includes(field)) continue
      fresh = this.add(['field', kind, id, field, content]) || fresh
    }
    return fresh
  }
  private collection(kind: string, values: unknown[]): boolean {
    let fresh = false
    for (const value of values) fresh = this.entity(kind, value) || fresh
    return fresh
  }
  private file(space: string, value: unknown, full = false): boolean | undefined {
    const row = object(value)
    if (!row || typeof row.path !== 'string' || typeof row.revision !== 'string') return
    const start = Number(row.startLine), end = Number(row.endLine)
    if (!full && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)) return
    const key = callDigest([space, row.path, row.revision]), previous = this.files.get(key)
    if (previous?.full) return false
    if (full) {
      const lines = typeof row.content === 'string' ? row.content.split('\n').length : 1
      const fresh = !previous?.ranges.some(([from, to]) => from === 1 && to >= lines)
      this.files.set(key, { full: true, ranges: [] })
      return fresh
    }
    const ranges = previous?.ranges ?? []
    const fresh = !ranges.some(([from, to]) => from <= start && to >= end)
    const merged: [number, number][] = []
    for (const range of [...ranges, [start, end] as [number, number]].sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1)
      if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
      else merged.push([...range])
    }
    this.files.set(key, { full: false, ranges: merged })
    return fresh
  }
  observe(tool: ToolDescriptor, args: JsonValue, output: ToolOutput): boolean {
    const row = object(output.structuredContent), input = object(args) ?? {}
    const fallback = () => this.add(['result', tool.name, output.structuredContent === undefined ? output.content : output.structuredContent])
    if (!row) return fallback()
    const space = tool.name.split('.')[0]
    if (['memory.recall', 'knowledge.search', 'knowledge.retrieve'].includes(tool.name)) {
      const values = row.sources ?? row.items
      if (!Array.isArray(values)) return fallback()
      if (!values.length) return this.add(['empty', space, 'retrieval'])
      let fresh = false
      for (const value of values) {
        const added = this.file(space, value)
        fresh = (added ?? this.add(['retrieval-result', space, value])) || fresh
      }
      return fresh
    }
    if (['memory.read', 'knowledge.read'].includes(tool.name)) return this.file(space, row, true) ?? fallback()
    if (['memory.list', 'knowledge.list'].includes(tool.name) && Array.isArray(row.items)) {
      if (!row.items.length) return this.add(['empty', space, 'directory', input.path ?? ''])
      let fresh = false
      for (const value of row.items) fresh = this.entity(`${space}-node`, value, object(value)?.path) || fresh
      return fresh
    }
    const kind = lists[tool.name]
    if (kind && Array.isArray(row.items)) {
      const dataset = input.profileId ?? input.jobId ?? input.runId ?? ''
      if (!row.items.length) return this.add(['empty', kind, dataset])
      return this.collection((kind === 'snapshot-fact' || kind === 'resume-bullet') ? `${kind}:${dataset}` : kind, row.items)
    }
    if (tool.name === 'profile.get') return this.entity('profile', row, input.id)
    if (tool.name === 'job.get') {
      if (!object(row.job)) return this.entity('job', row, input.id)
      const fresh = this.entity('job', row.job, input.id), sources = object(row.sources)?.items
      return (Array.isArray(sources) && this.collection('job-source', sources)) || fresh
    }
    if (tool.name === 'application.get') return this.entity('application', row, input.jobId)
    if (tool.name === 'artifact.get') return this.entity('artifact', row, input.id)
    return fallback()
  }
  clear() { this.seen.clear(); this.files.clear() }
}
