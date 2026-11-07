import type { GenerationRun } from '../../domain/resume/resume.types'
import { bulletSections } from '../../domain/resume/document'
import { DataError, fail } from '../../domain/common/errors'
import type { composeBackend } from '../database/backend'
import type { JsonSchema, JsonValue, RegisteredTool, ToolDescriptor, ToolExecutionContext } from '../../shared/tools/tool.types'
import { ToolError } from '../../shared/tools/errors'
import { jsonCopy } from './schema'
import { schemas } from './resume-schema'

type Backend = ReturnType<typeof composeBackend>
type Args = Record<string, unknown> & { runId: string }
const output = (value: unknown) => ({ content: [], structuredContent: value as JsonValue })
const state = (run: GenerationRun) => ({ runId: run.id, state: run.state, stateVersion: run.stateVersion, rewriteRevision: run.rewriteRevision, error: run.error })

/** Server-side resume capability bindings. Agents only use the MCP protocol. */
export function createResumeTools(backend: Backend, build: (id: string, signal: AbortSignal) => Promise<unknown>, internal = false) {
  const tools: RegisteredTool[] = []
  const run = (id: string) => backend.generationRun(id)
  function bind(name: string, description: string, schema: JsonSchema, write: boolean, operation: (args: Args, context: ToolExecutionContext) => unknown | Promise<unknown>) {
    const descriptor: ToolDescriptor = { name, description, inputSchema: schema, source: { type: 'native' }, tags: ['resume'], mode: write ? 'write' : 'read', risk: write ? 'WRITE' : 'READ' }
    tools.push(backend.capabilities[write ? 'write' : 'read'](descriptor, async (input, context) => {
      const args = input as Args
      if (context.runId && args.runId && context.runId !== args.runId) throw new ToolError('TOOL_FORBIDDEN')
      try { return output(await operation(args, context)) } catch (error) {
        if (!(error instanceof DataError)) throw error
        throw new ToolError(error.code === 'INVALID_INPUT' ? 'TOOL_INVALID_INPUT' : error.code === 'FORBIDDEN' ? 'TOOL_FORBIDDEN' :
          ['CONFLICT', 'INVALID_STATE'].includes(error.code) ? 'TOOL_CONFLICT' : error.code === 'STORAGE_BUSY' ? 'TOOL_BUSY' : 'TOOL_EXECUTION_FAILED')
      }
    }, { timeoutMs: name === 'artifact.build' ? 90000 : 30000, inputLimit: name === 'resume.rewrite_bullet' ? 131072 : 65536,
      runId: input => (input as Args).runId,
      target: input => name === 'artifact.build' ? { type: 'artifact', id: String((input as Args).artifactId) } : undefined }))
  }
  bind('resume.start', 'Create and start an immutable resume snapshot. Reuse requestId only for an identical retry. Returns runId. Limits: 1000 facts, 200 items, context 256 KiB, each fact 8 KiB.', schemas.start, true, args => {
    const current = backend.resumes.createRun({ jobId: args.jobId, profileId: args.profileId, config: {
      ...(args.model as { providerId: string; modelId: string } | undefined), ...(args.targetWordCount === undefined ? {} : { targetWordCount: args.targetWordCount }) } },
      { start: true, internal, requestId: String(args.requestId), validateSnapshot: snapshot => {
        if (snapshot.facts.length > 1000 || snapshot.items.length > 200) fail('INVALID_INPUT')
        try {
          jsonCopy({ job: snapshot.job, profile: snapshot.profile, items: snapshot.items, envelope: Array(64).fill(null) }, 262144, 'TOOL_INVALID_INPUT')
          for (const fact of snapshot.facts) jsonCopy(fact, 8192, 'TOOL_INVALID_INPUT')
        } catch { fail('INVALID_INPUT') }
      } })
    return state(current)
  })
  bind('resume.get_context', 'Read the immutable Job, Profile and Item snapshot and generation config.', schemas.context, false, args => {
    const current = run(args.runId)
    return { ...state(current), job: current.inputSnapshot.job, profile: current.inputSnapshot.profile,
      items: current.inputSnapshot.items, config: current.config, factCount: current.inputSnapshot.facts.length }
  })
  bind('resume.list_facts', 'Read immutable snapshot Facts. Advance offset by the returned item count.', schemas.facts, false, args => {
    const facts = run(args.runId).inputSnapshot.facts, offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 100)
    return { items: facts.slice(offset, offset + limit), total: facts.length }
  })
  bind('resume.list_bullets', 'Read current bullets and the shared revision. Advance offset by the returned item count.', schemas.facts, false, args => {
    const current = run(args.runId), document = current.assembled
    const bullets = document ? bulletSections.flatMap(section => document[section].flatMap(entry => entry.bullets.map(bullet =>
      ({ bulletId: bullet.id, profileItemId: entry.profileItemId, section, text: bullet.text, factIds: bullet.factIds })))) : []
    const items = [], offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20)
    let bytes = 0
    for (const item of bullets.slice(offset, offset + limit)) {
      bytes += Buffer.byteLength(JSON.stringify(item)) + 1
      if (bytes > 240_000) break
      items.push(item)
    }
    return { items, total: bullets.length, revision: current.rewriteRevision }
  })
  bind('resume.rewrite_bullet', 'Replace one bullet text using the current expectedRevision and a UUID v4 requestId. Identical requests return the original receipt.', schemas.rewrite, true,
    args => backend.generation.rewriteBullet(args))
  if (internal) bind('resume.attach_agent', 'Bind a trusted desktop Agent Run before model execution.', schemas.attach, true,
    args => {
      const requestId = String(args.requestId)
      if (backend.ownedStart(requestId)?.id !== args.runId) fail('FORBIDDEN')
      return backend.generation.attachAgent({ runId: args.runId, requestId, ownerRuntimeId: String(args.ownerRuntimeId) })
    })
  if (internal) bind('resume.validate', 'Close rewrites and enter validation after the Agent completes.', schemas.run, true,
    args => state(backend.generation.beginValidation(args.runId)))
  bind('resume.publish', 'Validate and publish the copied resume. A zero-rewrite run may publish. Identical retries return the existing Artifact.', schemas.run, true, (args, context) => {
    context.signal.throwIfAborted()
    backend.generation.beginValidation(args.runId)
    backend.generation.preparePublication(args.runId)
    context.signal.throwIfAborted()
    return { artifact: backend.generation.publishArtifact(args) }
  })
  bind('resume.cancel', 'Cancel this session’s unfinished resume and return its terminal state.', schemas.run, true,
    args => state(backend.generation.settle(args.runId, 'CANCELLED')))
  bind('resume.fail', 'Fail this session’s unfinished resume with a fixed error code.', schemas.fail, true,
    args => state(backend.generation.settle(args.runId, 'FAILED', String(args.error))))
  bind('artifact.build', 'Build HTML/PDF from a published Artifact without any model calls. Returns output status and local output file paths. Failed output can be retried.', schemas.artifact, true,
    (args, context) => {
      if (context.runId && backend.resumes.getArtifact({ id: args.artifactId }).artifact.generationRunId !== context.runId) fail('FORBIDDEN')
      return build(String(args.artifactId), context.signal)
    })
  return tools
}
