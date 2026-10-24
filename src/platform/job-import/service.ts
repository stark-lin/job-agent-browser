import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import type { Job, SourceDetails } from '../../domain/job/job.types'
import { jobDetails, sourceDetails } from '../../domain/job/job.validation'
import type { JobDraft, JobImportDraft, JobPageReader, JobPageSnapshot } from '../../domain/job/job.extractor'
import type { AIChoice, AISettings } from '../../shared/ai'
import type { AgentModel } from '../../shared/agent'
import type { ImportMode } from '../../shared/import'
import type { CaptureTaskView, JobImportEvent, JobImportError } from '../electron/job-import-contract'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { createCaptureBatch } from '../agent/capture'
import { importErrorCode } from '../import/batch'
import { checkImportMode, importMode } from '../import/policy'
import { extractPdf } from '../import/pdf'
import { mergeJobParts } from './parts'

interface Task {
  owner: number; controller: AbortController; emit: (event: JobImportEvent) => void; choice: AIChoice; mode: ImportMode
  state: CaptureTaskView['state']; source: { url?: string; text?: string; bytes?: Uint8Array }
  snapshot?: JobPageSnapshot; batch?: ReturnType<typeof createCaptureBatch>; draft: JobImportDraft | null
  requestId: string; saved?: Job; fingerprint?: string; done?: Promise<void>; saving?: Promise<Job>
}
interface Dependencies {
  reader: JobPageReader; model(choice: AIChoice): AgentModel; mcp: FirstPartyRuntime; settings?: () => AISettings; pdfWorker?: string
}
const startInput = v.object({ url: v.optionalUrl, text: v.optionalText(60000), fileId: v.optionalId,
  choice: v.object({ providerId: v.text(100, 1), modelId: v.text(200, 1) }), mode: importMode })

/** Window-owned capture lifecycle. Reading/reasoning is local; confirmed persistence uses MCP. */
export function createJobImporter(deps: Dependencies) {
  const tasks = new Map<string, Task>(), files = new Map<string, { owner: number; bytes: Uint8Array }>()
  let disposed = false
  function emit(taskId: string, task: Task, event: JobImportEvent) {
    if (tasks.get(taskId) !== task) return
    try { task.emit(event) } catch { task.controller.abort(); tasks.delete(taskId) }
  }
  function stop(taskId: string, task: Task) {
    task.controller.abort(); emit(taskId, task, { taskId, type: 'cancelled' }); tasks.delete(taskId)
  }
  function owned(owner: number, taskId: string) {
    const task = tasks.get(taskId)
    if (!task) fail('NOT_FOUND')
    if (task.owner !== owner) fail('FORBIDDEN')
    return task
  }
  async function run(taskId: string, task: Task) {
    try {
      if (!task.snapshot) {
        emit(taskId, task, { taskId, type: 'phase', phase: 'reading' })
        if (task.source.url) task.snapshot = await deps.reader.read(task.source.url, task.controller.signal)
        else {
          const text = task.source.text ?? (await extractPdf(task.source.bytes!, task.controller.signal, () => {}, deps.pdfWorker)).map(page => page.text).join('\n\n')
          if (!text.trim()) fail('INVALID_INPUT')
          task.snapshot = { requestedUrl: '', url: '', pageTitle: '', cleanedContent: text, jobPosting: [] }
          task.source.bytes = undefined
        }
      }
      task.controller.signal.throwIfAborted()
      emit(taskId, task, { taskId, type: 'phase', phase: 'parsing' })
      task.batch ??= createCaptureBatch(deps.model(task.choice), task.snapshot, task.mode)
      const details: JobDraft = mergeJobParts(await task.batch.run(task.controller.signal, groups => emit(taskId, task, { taskId, type: 'progress', groups })))
      task.controller.signal.throwIfAborted()
      const snapshot = task.snapshot
      const source: SourceDetails | null = task.source.url ? { url: snapshot.requestedUrl, platform: new URL(snapshot.url).hostname,
        externalId: '', pageTitle: snapshot.pageTitle, cleanedContent: [snapshot.cleanedContent,
          snapshot.jobPosting.length ? JSON.stringify(snapshot.jobPosting) : ''].filter(Boolean).join('\n\n') } : null
      for (const [id, previous] of tasks) if (id !== taskId && previous.owner === task.owner && previous.state === 'ready') tasks.delete(id)
      task.state = 'ready'; task.draft = { details, source }
      emit(taskId, task, { taskId, type: 'ready', draft: task.draft })
    } catch (error) {
      if (!task.controller.signal.aborted) {
        task.state = 'failed'
        emit(taskId, task, { taskId, type: 'failed', retryable: Boolean(task.batch?.retryable), error: importErrorCode(error) as JobImportError })
      }
    }
  }
  function launch(taskId: string, task: Task) {
    task.done = new Promise(resolve => setImmediate(() => { void run(taskId, task).finally(resolve) }))
  }
  return {
    select(owner: number, bytes: Uint8Array) {
      if (disposed) fail('INVALID_STATE')
      for (const [id, file] of files) if (file.owner === owner) files.delete(id)
      if (files.size >= 16) fail('INVALID_STATE')
      const fileId = randomUUID(); files.set(fileId, { owner, bytes: new Uint8Array(bytes) })
      return { fileId, bytes: bytes.length }
    },
    start(owner: number, input: unknown, callback: Task['emit']) {
      if (disposed) fail('INVALID_STATE')
      const args = startInput(input)
      if ([Boolean(args.url), Boolean(args.text), Boolean(args.fileId)].filter(Boolean).length !== 1) fail('INVALID_INPUT')
      checkImportMode(deps.settings?.(), args.choice, args.mode)
      if ([...tasks.values()].some(task => task.owner === owner && ['running', 'saving'].includes(task.state))) fail('INVALID_STATE')
      let bytes: Uint8Array | undefined
      if (args.fileId) {
        const file = files.get(args.fileId)
        if (!file) fail('NOT_FOUND')
        if (file.owner !== owner) fail('FORBIDDEN')
        bytes = file.bytes; files.delete(args.fileId)
      }
      for (const [id, task] of tasks) if (task.owner === owner && task.state !== 'ready') stop(id, task)
      if (tasks.size >= 16) fail('INVALID_STATE')
      const taskId = randomUUID(), task: Task = { owner, controller: new AbortController(), emit: callback,
        choice: args.choice, mode: args.mode, source: { url: args.url || undefined, text: args.text || undefined, bytes },
        state: 'running', draft: null, requestId: randomUUID() }
      tasks.set(taskId, task); launch(taskId, task)
      return { taskId }
    },
    retry(owner: number, input: unknown) {
      const { taskId } = v.object({ taskId: v.id })(input), task = owned(owner, taskId)
      if (task.state !== 'failed' || !task.batch?.retryable) fail('INVALID_STATE')
      task.state = 'running'; task.controller = new AbortController(); launch(taskId, task)
      return { taskId }
    },
    getTask(owner: number, input: unknown): CaptureTaskView {
      const { taskId } = v.object({ taskId: v.id })(input), task = owned(owner, taskId)
      return { taskId, state: task.state, draft: task.draft }
    },
    async save(owner: number, input: unknown) {
      const args = v.object({ taskId: v.id, details: jobDetails, source: v.optional(v.nullable(sourceDetails), null) })(input)
      const task = owned(owner, args.taskId)
      if (!['ready', 'saving', 'saved'].includes(task.state)) fail('INVALID_STATE')
      const payload = { details: args.details, source: args.source }, fingerprint = JSON.stringify(payload)
      if (task.fingerprint && task.fingerprint !== fingerprint) fail('CONFLICT')
      if (task.saved) return task.saved
      if (task.saving) return task.saving
      task.fingerprint = fingerprint; task.state = 'saving'
      task.saving = (async () => {
        try {
          const tools = await deps.mcp.session('job-capture', task.controller.signal)
          const saved = await tools.call('job.import', { ...payload, requestId: task.requestId }, task.controller.signal) as Job
          task.saved = saved; task.state = 'saved'; return saved
        } catch (error) {
          task.state = 'ready'
          if (importErrorCode(error) === 'TOOL_INVALID_INPUT') { task.fingerprint = undefined; task.requestId = randomUUID() }
          throw error
        } finally { task.saving = undefined }
      })()
      return task.saving
    },
    cancel(owner: number, input: unknown) {
      const { taskId } = v.object({ taskId: v.id })(input), task = tasks.get(taskId)
      if (!task) return
      if (task.owner !== owner) fail('FORBIDDEN')
      stop(taskId, task)
    },
    disposeOwner(owner: number) {
      for (const [id, task] of tasks) if (task.owner === owner) stop(id, task)
      for (const [id, file] of files) if (file.owner === owner) files.delete(id)
    },
    async dispose() {
      disposed = true
      const work = [...tasks.values()]
      for (const [id, task] of tasks) stop(id, task)
      files.clear(); await Promise.allSettled(work.flatMap(task => [task.done, task.saving]))
    }
  }
}
export type JobImporter = ReturnType<typeof createJobImporter>
