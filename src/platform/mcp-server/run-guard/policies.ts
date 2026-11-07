import type { JsonValue, ToolDescriptor } from '../../../shared/tools/tool.types'
import { callDigest } from '../../mcp/call-fingerprint'
const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
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
  if (tool.mode !== 'write') return
  if (tool.name === 'resume.rewrite_bullet' && o.changed === true && typeof o.runId === 'string' && Number.isSafeInteger(o.rewriteRevision))
    return `rewrite:${callDigest([o.runId, o.rewriteRevision])}`
  if (tool.name.startsWith('resume.') && typeof o.runId === 'string' && typeof o.status === 'string' && typeof o.stage === 'string')
    return `workflow:${callDigest([o.runId, o.status, o.stage])}`
  if ((tool.name.startsWith('profile.') || ['memory.write', 'memory.mkdir', 'knowledge.write', 'knowledge.mkdir'].includes(tool.name)) && (typeof o.revision === 'string' || Number.isSafeInteger(o.revision))) {
    const id = o.profileId ?? a?.profileId ?? o.id ?? o.path ?? a?.path
    if (typeof id === 'string') return `revision:${callDigest([tool.name.split('.')[0], id, o.revision])}`
  }
  if ((['job.import', 'job.update'].includes(tool.name) || tool.name.startsWith('application.')) && (typeof o.id === 'string' || typeof o.jobId === 'string'))
    return `mutation:${callDigest([tool.name, Object.fromEntries(Object.entries(o).filter(([key]) => !['updatedAt', 'createdAt'].includes(key)))])}`
  if (tool.name === 'knowledge.move' && o.ok === true && typeof a?.source === 'string' && typeof a.target === 'string')
    return `move:${callDigest([a.source, a.target, a.expectedRevision])}`
}
