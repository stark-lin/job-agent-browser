import type { GenerationRun } from '../../domain/resume/resume.types'
import { documentProvenance } from '../../domain/resume/document'
import { DataError, fail } from '../../domain/common/errors'
import type { composeBackend } from '../database/backend'
import type { JsonSchema, JsonValue, RegisteredTool, ToolDescriptor, ToolExecutionContext } from '../../shared/tools/tool.types'
import { ToolError } from '../../shared/tools/errors'
import { jsonCopy } from './schema'
import { schemas } from './resume-schema'

type Backend = ReturnType<typeof composeBackend>
type Args = Record<string, unknown> & { runId: string }
const output = (value: unknown) => ({ content: [], structuredContent: value as JsonValue })
const state = (run: GenerationRun) => ({ runId: run.id, status: run.status, stage: run.stage, language: run.language, error: run.error })

/** Server-side resume capability bindings. Agents only use the MCP protocol. */
export function createResumeTools(backend: Backend, build: (id: string, signal: AbortSignal) => Promise<unknown>) {
  const tools: RegisteredTool[] = []
  const run = (id: string) => backend.resumes.getRun({ id }).run
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
    }, { timeoutMs: name === 'artifact.build' ? 90000 : 30000, inputLimit: name === 'resume.submit_optimization' ? 524288 : 65536,
      runId: input => (input as Args).runId,
      target: input => name === 'artifact.build' ? { type: 'artifact', id: String((input as Args).artifactId) } : undefined }))
  }
  bind('resume.start', 'Create and start an immutable resume snapshot. Reuse requestId only for an identical retry. Returns runId. Limits: 1000 facts, 200 items, context 256 KiB, each fact 8 KiB.', schemas.start, true, args => {
    const current = backend.resumes.createRun({ jobId: args.jobId, profileId: args.profileId, config: {
      ...(args.model as { providerId: string; modelId: string } | undefined), ...(args.targetWordCount === undefined ? {} : { targetWordCount: args.targetWordCount }) } },
      { start: true, requestId: String(args.requestId), validateSnapshot: snapshot => {
        if (snapshot.facts.length > 1000 || snapshot.items.length > 200) fail('INVALID_INPUT')
        try {
          jsonCopy({ job: snapshot.job, profile: snapshot.profile, items: snapshot.items, envelope: Array(64).fill(null) }, 262144, 'TOOL_INVALID_INPUT')
          for (const fact of snapshot.facts) jsonCopy(fact, 8192, 'TOOL_INVALID_INPUT')
        } catch { fail('INVALID_INPUT') }
      } })
    return state(current)
  })
  bind('resume.get_context', 'Read only GenerationRun.inputSnapshot. Default section=context returns job/profile/items/config; progress returns accepted scores/gate/selection; draft and polished return historical documents; assembled returns the accepted new document.', schemas.context, false, args => {
    const current = run(args.runId), section = args.section ?? 'context'
    return { ...state(current), ...(section === 'context' ? { job: current.inputSnapshot.job, profile: current.inputSnapshot.profile,
      items: current.inputSnapshot.items, config: current.config, factCount: current.inputSnapshot.facts.length } : section === 'progress'
      ? { scores: current.scores, gate: current.gate, selection: current.selection } : { document: section === 'draft' ? current.draft : section === 'polished' ? current.polished : current.assembled ?? null }) }
  })
  bind('resume.list_facts', 'Read every immutable snapshot fact page. Defaults offset=0, limit=100; continue until offset reaches total.', schemas.facts, false, args => {
    const facts = run(args.runId).inputSnapshot.facts, offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 100)
    return { items: facts.slice(offset, offset + limit), total: facts.length }
  })
  bind('resume.submit_optimization', 'Submit evidence-backed writing for deterministic assembly. Identical retries return the accepted state.', schemas.optimization, true, args => {
    backend.lease.assert('generation', args.runId)
    const references = backend.resumes.getRun({ id: args.runId }).references
    return state(backend.generation.submitOptimization({ id: args.runId, optimization: args.optimization }, content => {
      try { jsonCopy({ content, provenance: documentProvenance(content), references, envelope: Array(128).fill(null) }, 900000, 'TOOL_INVALID_INPUT') }
      catch (error) {
        if (error instanceof ToolError && error.code === 'TOOL_INVALID_INPUT') fail('INVALID_INPUT')
        throw error
      }
    }))
  })
  bind('resume.publish', 'Publish the validated assembled resume. An identical retry returns the existing published Artifact.', schemas.run, true, args => {
    backend.lease.assert('generation', args.runId)
    const current = run(args.runId), previous = backend.artifactForRun(current.id)
    const artifact = previous ?? backend.generation.publishArtifact({ id: current.id, title: `${current.inputSnapshot.profile.name} — ${current.inputSnapshot.job.title}`.slice(0, 500) })
    return { artifact }
  })
  bind('resume.cancel', 'Cancel this runtime\'s unfinished resume; terminal state is returned unchanged.', schemas.run, true, args => {
    backend.lease.assert('generation', args.runId)
    const current = run(args.runId)
    return state(['PENDING', 'RUNNING'].includes(current.status) ? backend.resumes.cancelRun({ id: current.id }) : current)
  })
  bind('resume.fail', 'Fail this runtime\'s unfinished resume with a fixed error code; terminal state is returned unchanged.', schemas.fail, true, args => {
    backend.lease.assert('generation', args.runId)
    const current = run(args.runId)
    return state(['PENDING', 'RUNNING'].includes(current.status) ? backend.generation.failRun({ id: current.id, error: args.error }) : current)
  })
  bind('artifact.build', 'Build HTML/PDF from a published Artifact without any model calls. Returns output status and local output file paths. Failed output can be retried.', schemas.artifact, true,
    (args, context) => {
      if (context.runId && backend.resumes.getArtifact({ id: args.artifactId }).artifact.generationRunId !== context.runId) fail('FORBIDDEN')
      return build(String(args.artifactId), context.signal)
    })
  return tools
}
