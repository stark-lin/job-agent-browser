import { createKnowledgeTools } from './knowledge'
import type { KnowledgeService } from '../knowledge/service'
import type { composeBackend } from '../database/backend'
import { createToolRegistry } from '../../shared/tools/registry'
import { createResumeTools } from './resume'
import { createProfileTools } from './profile'
import { createJobTools } from './job'
import { createApplicationTools } from './application'

export { jobAgentAllowlist } from '../../shared/agent/business-policy'

/** The sole public registry composition. ToolScope stays inside the Server boundary. */
export function createJobAgentTooling(backend: ReturnType<typeof composeBackend>, build: (id: string, signal: AbortSignal) => Promise<unknown>, knowledge?: KnowledgeService, memory?: KnowledgeService, internalResume = false) {
  const registry = createToolRegistry()
  const tools = [...(memory ? createKnowledgeTools(backend.capabilities, memory, 'memory') : []), ...createKnowledgeTools(backend.capabilities, knowledge), ...backend.toolCapabilities.read, backend.toolCapabilities.write.setArchived,
    ...createJobTools(backend), ...createProfileTools(backend), ...createApplicationTools(backend), ...createResumeTools(backend, build, internalResume)]
  for (const tool of tools) registry.register(tool)
  return { registry, tools, dispose() { registry.dispose() } }
}
