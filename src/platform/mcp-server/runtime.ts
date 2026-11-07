import type { MemoryAuthorization } from '../mcp/memory-authority'
import { resumeAgentTools, resumeAgentLifecycle } from '../../shared/agent/resume-policy'
import { askToolAllowlist } from '../../shared/agent/ask-policy'
import { SmartNoteWorkspace } from '../knowledge/workspace'
import { createPreferences } from '../storage/preferences'
import { defaultKnowledgePreferences } from '../../shared/knowledge-settings'
import { join, isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createBackend } from '../database/backend'
import { createJobAgentTooling, jobAgentAllowlist } from '../tools'
import { createResumeOutput, type ResumeRenderer } from '../resume-output/service'
import { electronRenderer } from '../resume-output/worker-client'
import { createMCPServer } from './server'

export function createServerRuntime(directory: string, bundleDirectory: string, render?: ResumeRenderer, caller?: string, memoryAuthorization?: MemoryAuthorization, askReadOnly = false) {
  if (!isAbsolute(directory) || !statSync(join(directory, 'database.sqlite')).isFile()) throw new Error('MCP_DATA_REQUIRED')
  if (typeof DatabaseSync.prototype.setAuthorizer !== 'function') throw new Error('MCP_NODE_UNSUPPORTED')
  const backend = createBackend(join(directory, 'database.sqlite'), undefined, 'external')
  const lifecycle = new AbortController()
  const output = createResumeOutput(backend, join(directory, 'artifacts'), join(bundleDirectory, 'fonts'), render ?? electronRenderer(join(bundleDirectory, 'resume-output-worker.js')))
  const preferences = createPreferences(join(directory,'settings.json'))
  const knowledge = new SmartNoteWorkspace(directory, {preferences:()=>preferences.get({}).knowledge ?? defaultKnowledgePreferences}, false)
  const internalResume = memoryAuthorization?.kind === 'resume'
  const tooling = createJobAgentTooling(backend, (id, signal) => output.build(id, signal), knowledge.spaces.knowledge,
    memoryAuthorization ? knowledge.spaces.memory : undefined, internalResume)
  const allow = internalResume ? [...resumeAgentTools, ...resumeAgentLifecycle] : memoryAuthorization ? askToolAllowlist : jobAgentAllowlist
  const mcp = createMCPServer(tooling.registry, { allow, maxRisk: askReadOnly && memoryAuthorization ? 'COMPUTE' : 'WRITE' }, memoryAuthorization ? AbortSignal.any([lifecycle.signal, memoryAuthorization.signal]) : lifecycle.signal, caller,
    async (name, args, metadata) => {
      if (!['memory.write', 'memory.mkdir'].includes(name)) return true
      const token = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).jabMemoryGrant : undefined
      return Boolean(memoryAuthorization && await memoryAuthorization.authorize?.(token, name, args))
    }, memoryAuthorization ? {
      async authorize(name, args, metadata) {
        const grant = await memoryAuthorization.authorizeRun(metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).jabRunGrant : undefined, name, args)
        if (grant?.kind === 'resume') {
          try {
            const run = backend.generationRun(grant.generationRunId!)
            if (run.agentRunId !== grant.agentRunId || run.state !== 'REWRITING' || backend.chats.getAgentRun(grant.agentRunId).state !== 'running') return
            backend.lease.assert('generation', run.id)
          } catch { return }
        }
        return grant
      },
      onClosed: listener => memoryAuthorization.onRunClosed(listener)
    } : undefined)
  let disposal: Promise<void> | undefined
  return { backend, tooling, ready: knowledge.ready, server: mcp.server, dispose() {
    return disposal ??= (async () => {
      lifecycle.abort(); memoryAuthorization?.close(); await mcp.dispose(); tooling.dispose(); await backend.capabilities.dispose(); await output.settle(); await knowledge.close(); backend.close()
    })()
  } }
}
