import { join, isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createBackend } from '../database/backend'
import { createJobAgentTooling, jobAgentAllowlist } from '../tools'
import { createResumeOutput, type ResumeRenderer } from '../resume-output/service'
import { electronRenderer } from '../resume-output/worker-client'
import { createMCPServer } from './server'

export function createServerRuntime(directory: string, bundleDirectory: string, render?: ResumeRenderer, caller?: string) {
  if (!isAbsolute(directory) || !statSync(join(directory, 'database.sqlite')).isFile()) throw new Error('MCP_DATA_REQUIRED')
  if (typeof DatabaseSync.prototype.setAuthorizer !== 'function') throw new Error('MCP_NODE_UNSUPPORTED')
  const backend = createBackend(join(directory, 'database.sqlite'), undefined, 'external')
  const lifecycle = new AbortController()
  const output = createResumeOutput(backend, join(directory, 'artifacts'), join(bundleDirectory, 'fonts'), render ?? electronRenderer(join(bundleDirectory, 'resume-output-worker.js')))
  const tooling = createJobAgentTooling(backend, (id, signal) => output.build(id, signal))
  const mcp = createMCPServer(tooling.registry, { allow: jobAgentAllowlist, maxRisk: 'WRITE' }, lifecycle.signal, caller)
  let disposal: Promise<void> | undefined
  return { backend, tooling, server: mcp.server, dispose() {
    return disposal ??= (async () => {
      lifecycle.abort(); await mcp.dispose(); tooling.dispose(); await backend.capabilities.dispose(); await output.settle(); backend.close()
    })()
  } }
}
