import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import type { JobDraft, JobExtractor, JobPageReader, JobPageSnapshot } from '../../domain/job/job.extractor'
import type { AIChoice, AISettings } from '../../shared/ai'
import type { ImportMode } from '../../shared/import'
import type { JobImportEvent } from '../electron/job-import-contract'
import { aiError, type AIService } from '../ai'
import { createImportBatch, ImportRequestFailure } from '../import/batch'
import { checkImportMode, importMode } from '../import/policy'
import { jobParts, mergeJobParts } from './parts'
import { JobImportFailure } from './errors'

interface Task {
  owner: number; controller: AbortController; emit: (event: JobImportEvent) => void
  url: string; choice: AIChoice; mode: ImportMode; state: 'running' | 'failed'
  snapshot?: JobPageSnapshot; batch?: ReturnType<typeof createImportBatch<Partial<JobDraft>>>
}
interface Dependencies {
  reader: JobPageReader
  ai: Pick<AIService, 'start' | 'cancel'>
  settings?: () => AISettings
  extractor?: (owner: number, choice: AIChoice) => JobExtractor
}
const startInput = v.object({ url: v.url, choice: v.object({ providerId: v.text(100, 1), modelId: v.text(200, 1) }), mode: importMode })

/** Failed batches retain only this task's source/results for explicit retry; saving stays separate. */
export function createJobImporter(deps: Dependencies) {
  const tasks = new Map<string, Task>()
  function emit(taskId: string, task: Task, event: JobImportEvent) {
    if (tasks.get(taskId) !== task) return
    try { task.emit(event) } catch { task.controller.abort(); tasks.delete(taskId) }
  }
  function stop(taskId: string, task: Task) {
    task.controller.abort()
    emit(taskId, task, { taskId, type: 'cancelled' }); tasks.delete(taskId)
  }
  async function run(taskId: string, task: Task) {
    try {
      if (!task.snapshot) {
        emit(taskId, task, { taskId, type: 'phase', phase: 'reading' })
        task.snapshot = await deps.reader.read(task.url, task.controller.signal)
      }
      task.controller.signal.throwIfAborted()
      const snapshot = task.snapshot
      emit(taskId, task, { taskId, type: 'phase', phase: 'parsing' })
      let details: JobDraft
      if (deps.extractor && task.mode === 'single') details = await deps.extractor(task.owner, task.choice).extract(snapshot, task.controller.signal)
      else {
        task.batch ??= createImportBatch(deps.ai, task.owner, task.choice, jobParts(snapshot, task.mode))
        details = mergeJobParts(await task.batch.run(task.controller.signal, groups => emit(taskId, task, { taskId, type: 'progress', groups })))
      }
      task.controller.signal.throwIfAborted()
      emit(taskId, task, { taskId, type: 'ready', draft: { details, source: { url: snapshot.requestedUrl,
        platform: new URL(snapshot.url).hostname, externalId: '', pageTitle: snapshot.pageTitle,
        cleanedContent: [snapshot.cleanedContent, snapshot.jobPosting.length ? JSON.stringify(snapshot.jobPosting) : ''].filter(Boolean).join('\n\n') } } })
      tasks.delete(taskId)
    } catch (error) {
      if (!task.controller.signal.aborted) {
        task.state = 'failed'
        const retryable = Boolean(task.batch?.retryable)
        emit(taskId, task, { taskId, type: 'failed', retryable, error: error instanceof JobImportFailure || error instanceof ImportRequestFailure ? error.code : aiError(error) })
        if (!retryable) tasks.delete(taskId)
      }
    }
  }
  return {
    start(owner: number, input: unknown, callback: (event: JobImportEvent) => void) {
      const args = startInput(input)
      checkImportMode(deps.settings?.(), args.choice, args.mode)
      if ([...tasks.values()].some(task => task.owner === owner && task.state === 'running')) fail('AI_PROVIDER_FAILED')
      for (const [id, task] of tasks) if (task.owner === owner) stop(id, task)
      if (tasks.size >= 16) fail('AI_PROVIDER_FAILED')
      const taskId = randomUUID(), task: Task = { owner, controller: new AbortController(), emit: callback, ...args, state: 'running' }
      tasks.set(taskId, task)
      setImmediate(() => { if (tasks.get(taskId) === task) void run(taskId, task) })
      return { taskId }
    },
    retry(owner: number, input: unknown) {
      const { taskId } = v.object({ taskId: v.id })(input), task = tasks.get(taskId)
      if (!task) fail('INVALID_INPUT')
      if (task.owner !== owner) fail('FORBIDDEN')
      if (task.state !== 'failed' || !task.batch?.retryable) fail('INVALID_INPUT')
      task.state = 'running'; task.controller = new AbortController()
      setImmediate(() => { if (tasks.get(taskId) === task) void run(taskId, task) })
      return { taskId }
    },
    cancel(owner: number, input: unknown) {
      const { taskId } = v.object({ taskId: v.id })(input), task = tasks.get(taskId)
      if (!task) return
      if (task.owner !== owner) fail('FORBIDDEN')
      stop(taskId, task)
    },
    disposeOwner(owner: number) { for (const [id, task] of tasks) if (task.owner === owner) stop(id, task) },
    dispose() { for (const [id, task] of tasks) stop(id, task) }
  }
}
export type JobImporter = ReturnType<typeof createJobImporter>
