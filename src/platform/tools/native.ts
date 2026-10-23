import type { ServiceContract } from '../electron/data-contract'
import type { JsonSchema, JsonValue, RegisteredTool, ToolDescriptor } from '../../shared/tools/tool.types'
import { ToolError } from '../../shared/tools/errors'
import { DataError } from '../../domain/common/errors'
import type { AuditedCapabilities } from './capabilities'

const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
const byId: JsonSchema = { type: 'object', properties: { id: uuid }, required: ['id'], additionalProperties: false }
const page = { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } }

/** Hand-written business capability bindings; no backend dispatch, SQL or trusted mutations. */
export function createNativeCapabilities(services: Pick<ServiceContract, 'jobs' | 'profiles' | 'resumes'>, capabilities: AuditedCapabilities) {
  const read: RegisteredTool[] = []
  function bind<Input>(name: string, description: string, inputSchema: JsonSchema, operation: (input: Input) => unknown,
    targetType?: 'job' | 'profile' | 'artifact', write = false, targetKey = 'id'): RegisteredTool {
    const descriptor: ToolDescriptor = { name, description, inputSchema, source: { type: 'native' }, tags: [], mode: write ? 'write' : 'read', risk: write ? 'WRITE' : 'READ' }
    return capabilities[write ? 'write' : 'read'](descriptor, input => {
      try { return { content: [], structuredContent: operation(input as Input) as JsonValue } }
      catch (error) {
        throw new ToolError(error instanceof DataError && error.code === 'INVALID_INPUT' ? 'TOOL_INVALID_INPUT' : 'TOOL_EXECUTION_FAILED')
      }
    }, { target: targetType ? input => ({ type: targetType, id: (input as Record<string, string>)[targetKey] }) : undefined })
  }
  read.push(bind('job.get', 'Read a saved job by ID.', byId, services.jobs.getJob, 'job'))
  read.push(bind('job.list', 'List saved jobs.', { type: 'object', properties: page, additionalProperties: false }, services.jobs.listJobs))
  read.push(bind('profile.get', 'Read a saved profile by ID.', byId, services.profiles.getProfile, 'profile'))
  read.push(bind('profile.list_facts', 'List facts belonging to a profile.', { type: 'object', properties: { profileId: uuid, ...page },
    required: ['profileId'], additionalProperties: false }, services.profiles.listFacts, 'profile', false, 'profileId'))
  read.push(bind('artifact.get', 'Read an existing artifact and its provenance.', byId, services.resumes.getArtifact, 'artifact'))
  const setArchived = bind('job.set_archived', 'Archive or restore a saved job.', { type: 'object', properties: { id: uuid, archived: { type: 'boolean' } },
    required: ['id', 'archived'], additionalProperties: false }, services.jobs.setArchived, 'job', true)
  return { read, write: { setArchived } }
}
