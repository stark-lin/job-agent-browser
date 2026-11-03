import type { JsonValue, ToolDescriptor } from '../../../shared/tools/tool.types'
import { callDigest } from '../../mcp/call-fingerprint'
const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
const pick = (v: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]]))
/** Only explicitly registered, stable output shapes contribute progress. */
const readFields: Record<string, string[]> = {
  'job.get': ['job', 'sources'], 'job.list': ['items', 'total'],
  'profile.get': ['id', 'revision', 'name', 'email', 'phone', 'location', 'links', 'introduction', 'updatedAt'],
  'profile.list': ['items', 'total'], 'profile.list_items': ['items', 'total'], 'profile.list_facts': ['items', 'total'],
  'resume.get_context': ['runId', 'status', 'stage', 'language', 'error', 'job', 'profile', 'items', 'config', 'factCount', 'scores', 'gate', 'selection', 'document'],
  'resume.list_facts': ['items', 'total'],
  'memory.read': ['path', 'content', 'revision'], 'knowledge.read': ['path', 'content', 'revision'],
  'memory.list': ['items', 'total'], 'knowledge.list': ['items', 'total']
}
export function confirmedArchive(args: unknown, output: unknown): { id: string; archived: boolean } | undefined {
  const a = object(args), o = object(output)
  if (!a || !o || o.id !== a.id || typeof a.id !== 'string' || typeof a.archived !== 'boolean'
    || !(o.archivedAt === null || typeof o.archivedAt === 'string' && Number.isFinite(Date.parse(o.archivedAt)))) return
  if ((o.archivedAt !== null) !== a.archived) return
  return { id: a.id, archived: a.archived }
}
export function progressKey(tool: ToolDescriptor, args: JsonValue, output: unknown): string | undefined {
  const o = object(output), a = object(args)
  if (!o) return
  const fields = readFields[tool.name]
  if (tool.mode === 'read' && fields) {
    const selected = pick(o, fields)
    if (Object.keys(selected).length) return `read:${callDigest([tool.name, args, selected])}`
  }
  if (tool.mode !== 'write') return
  if (tool.name.startsWith('resume.') && typeof o.runId === 'string' && typeof o.status === 'string' && typeof o.stage === 'string')
    return `workflow:${callDigest([o.runId, o.status, o.stage])}`
  if ((tool.name.startsWith('profile.') || ['memory.write', 'memory.mkdir'].includes(tool.name)) && (typeof o.revision === 'string' || Number.isSafeInteger(o.revision))) {
    const id = o.profileId ?? a?.profileId ?? o.id ?? o.path ?? a?.path
    if (typeof id === 'string') return `revision:${callDigest([tool.name.split('.')[0], id, o.revision])}`
  }
}
