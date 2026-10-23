import type { InputSnapshot } from '../../domain/resume/resume.types'
import type { JsonSchema, JsonValue, ToolDescriptor } from '../../shared/tools/tool.types'
import { createToolRegistry } from '../../shared/tools/registry'
import { frozenCopy } from '../../shared/tools/immutable'
import { ToolError } from '../../shared/tools/errors'
import type { AuditedCapabilities } from '../tools/capabilities'

/** A private registry per task. No live repositories or external MCP capabilities. */
export function snapshotTools(input: InputSnapshot, audit: AuditedCapabilities, runId: string, signal: AbortSignal) {
  const snapshot = frozenCopy(input), registry = createToolRegistry()
  const idSchema = (id: string): JsonSchema => ({ type: 'string', const: id })
  function bind(name: string, description: string, properties: JsonSchema, required: string[], read: (input: Record<string, unknown>) => unknown, target: 'job' | 'profile', key: string) {
    const descriptor: ToolDescriptor = { name, description, source: { type: 'native' }, tags: ['resume'], mode: 'read', risk: 'READ',
      inputSchema: { type: 'object', properties, required, additionalProperties: false } }
    registry.register(audit.read(descriptor, args => {
      const value = args as Record<string, unknown>
      if (value[key] !== (target === 'job' ? snapshot.job.id : snapshot.profile.id)) throw new ToolError('TOOL_FORBIDDEN')
      return { content: [], structuredContent: structuredClone(read(value)) as JsonValue }
    }, { target: () => ({ type: target, id: target === 'job' ? snapshot.job.id : snapshot.profile.id }) }))
  }
  bind('job.get', 'Read the immutable target job.', { id: idSchema(snapshot.job.id) }, ['id'], () => snapshot.job, 'job', 'id')
  bind('profile.get', 'Read immutable contact and all profile items.', { id: idSchema(snapshot.profile.id) }, ['id'], () => ({ profile: snapshot.profile, items: snapshot.items }), 'profile', 'id')
  bind('profile.list_facts', 'Page through all immutable saved facts. No confirmation filter.', { profileId: idSchema(snapshot.profile.id),
    limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } }, ['profileId'], args => {
    const offset = typeof args.offset === 'number' ? args.offset : 0, limit = typeof args.limit === 'number' ? args.limit : 100
    return { items: snapshot.facts.slice(offset, offset + limit), total: snapshot.facts.length }
  }, 'profile', 'profileId')
  const scope = registry.scope({ allow: ['job.get', 'profile.get', 'profile.list_facts'], maxRisk: 'READ' }, { agentId: 'resume', runId, signal })
  return { scope, dispose() { scope.dispose(); registry.dispose() } }
}
