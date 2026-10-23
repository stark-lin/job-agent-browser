import type { GenerationConfig, GenerationRun } from '../../domain/resume/resume.types'
import { isDeepStrictEqual } from 'node:util'
import { materializeDocument, documentProvenance } from '../../domain/resume/document'
import * as check from '../../domain/resume/resume.validation'
import { DataError, fail } from '../../domain/common/errors'
import { resumeReadTools, resumeSubmitTools } from '../../domain/resume/workflow'
import type { composeBackend } from '../database/backend'
import type { JsonSchema, JsonValue, RegisteredTool, ToolDescriptor, ToolExecutionContext } from '../../shared/tools/tool.types'
import { createToolRegistry } from '../../shared/tools/registry'
import { ToolError } from '../../shared/tools/errors'
import { jsonCopy } from './schema'
import { schemas } from './resume-schema'

export const resumeAllowlist = ['job.list', 'profile.list', 'resume.start', ...resumeReadTools, ...resumeSubmitTools,
  'resume.publish', 'resume.cancel', 'artifact.build', 'artifact.get'] as const
type Backend = ReturnType<typeof composeBackend>
type Args = Record<string, unknown> & { runId: string }
const output = (value: unknown) => ({ content: [], structuredContent: value as JsonValue })
const state = (run: GenerationRun) => ({ runId: run.id, status: run.status, stage: run.stage, language: run.language, error: run.error })

/** The sole resume binding layer: both internal controllers and MCP execute these handlers. */
export function createResumeTooling(backend: Backend, build: (id: string, signal: AbortSignal) => Promise<unknown>, config: Partial<GenerationConfig> = {}) {
  const registry = createToolRegistry(), tools: RegisteredTool[] = []
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
    }, { timeoutMs: name === 'artifact.build' ? 90000 : 30000, inputLimit: name === 'resume.submit_scores' ? 1048576 : name.includes('draft') || name.includes('polished') ? 524288 : 65536,
      runId: input => (input as Args).runId,
      target: input => name === 'artifact.build' ? { type: 'artifact', id: String((input as Args).artifactId) } : undefined }))
  }
  bind('resume.start', 'Create and start an immutable resume snapshot. Reuse requestId only for an identical retry. Returns runId. Limits: 1000 facts, 200 items, context 256 KiB, each fact 8 KiB.', schemas.start, true, args => {
    const current = backend.resumes.createRun({ jobId: args.jobId, profileId: args.profileId, config: { ...config, ...(args.targetWordCount === undefined ? {} : { targetWordCount: args.targetWordCount }) } },
      { start: true, requestId: String(args.requestId), validateSnapshot: snapshot => {
        if (snapshot.facts.length > 1000 || snapshot.items.length > 200) fail('INVALID_INPUT')
        try {
          jsonCopy({ job: snapshot.job, profile: snapshot.profile, items: snapshot.items, envelope: Array(64).fill(null) }, 262144, 'TOOL_INVALID_INPUT')
          for (const fact of snapshot.facts) jsonCopy(fact, 8192, 'TOOL_INVALID_INPUT')
        } catch { fail('INVALID_INPUT') }
      } })
    return state(current)
  })
  bind('resume.get_context', 'Read only GenerationRun.inputSnapshot. Default section=context returns job/profile/items/config; progress returns accepted scores/gate/selection; draft and polished return saved documents.', schemas.context, false, args => {
    const current = run(args.runId), section = args.section ?? 'context'
    return { ...state(current), ...(section === 'context' ? { job: current.inputSnapshot.job, profile: current.inputSnapshot.profile,
      items: current.inputSnapshot.items, config: current.config, factCount: current.inputSnapshot.facts.length } : section === 'progress'
      ? { scores: current.scores, gate: current.gate, selection: current.selection } : { document: section === 'draft' ? current.draft : current.polished }) }
  })
  bind('resume.list_facts', 'Read every immutable snapshot fact page. Defaults offset=0, limit=100; continue until offset reaches total.', schemas.facts, false, args => {
    const facts = run(args.runId).inputSnapshot.facts, offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 100)
    return { items: facts.slice(offset, offset + limit), total: facts.length }
  })
  function submit(name: string, schema: JsonSchema, field: 'scores' | 'gate' | 'selection' | 'draft' | 'polished', value: (args: Args, current: GenerationRun) => unknown,
    save: (current: GenerationRun, accepted: unknown, args: Args) => GenerationRun) {
    bind(name, `Submit ${field} for the current resume stage. An identical retry returns the accepted state; conflicting or out-of-order submissions fail.`, schema, true, args => {
      backend.lease.assert('generation', args.runId)
      const current = run(args.runId), accepted = value(args, current)
      if (current[field] !== null) {
        if (!isDeepStrictEqual(current[field], accepted) || field === 'scores' && current.language !== args.language) fail('CONFLICT')
        return state(current)
      }
      return state(save(current, accepted, args))
    })
  }
  submit('resume.submit_scores', schemas.scores, 'scores', args => {
    const scores = check.scores(args.scores)
    jsonCopy(scores, 786432, 'TOOL_INVALID_INPUT') // Reserve space for gate/selection in progress reads.
    return scores
  }, (current, scores, args) => backend.generation.recordScores({ id: current.id, language: args.language, scores }))
  submit('resume.submit_gate', schemas.gate, 'gate', args => check.gate(args.gate), (current, gate) => backend.generation.recordGate({ id: current.id, gate }))
  submit('resume.submit_selection', schemas.selection, 'selection', args => check.selection(args.selection), (current, selection) => backend.generation.selectEvidence({ id: current.id, selection }))
  const document = (args: Args, current: GenerationRun) => {
    if (!current.language) fail('INVALID_STATE')
    const content = materializeDocument(current.inputSnapshot, current.language, check.writing(args.writing))
    // Ensure publication and Artifact reads remain possible before accepting the stage.
    jsonCopy({ content, provenance: documentProvenance(content), references: backend.resumes.getRun({ id: current.id }).references,
      envelope: Array(128).fill(null) }, 900000, 'TOOL_INVALID_INPUT')
    return content
  }
  submit('resume.submit_draft', schemas.writing, 'draft', document, (current, content) => backend.generation.saveDraft({ id: current.id, content }))
  submit('resume.submit_polished', schemas.writing, 'polished', document, (current, content) => backend.generation.savePolished({ id: current.id, content }))
  bind('resume.publish', 'Publish the validated polished resume. An identical retry returns the existing published Artifact.', schemas.run, true, args => {
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
  bind('artifact.build', 'Build HTML/PDF from a published Artifact without any model calls. Returns output status and local output file paths. Failed output can be retried.', schemas.artifact, true,
    (args, context) => {
      if (context.runId && backend.resumes.getArtifact({ id: args.artifactId }).artifact.generationRunId !== context.runId) fail('FORBIDDEN')
      return build(String(args.artifactId), context.signal)
    })
  for (const tool of [...backend.toolCapabilities.read, ...tools]) registry.register(tool)
  return { registry, tools, dispose() { registry.dispose() } }
}
