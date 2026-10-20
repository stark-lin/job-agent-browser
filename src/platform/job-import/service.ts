import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import type { JobExtractor, JobPageReader } from '../../domain/job/job.extractor'
import type { AIChoice } from '../../shared/ai'
import type { JobImportEvent } from '../electron/job-import-contract'
import { aiError, type AIService } from '../ai'
import { createJobExtractor } from './extractor'
import { JobImportFailure } from './errors'

interface Task { owner: number; controller: AbortController; emit: (event: JobImportEvent) => void }
interface Dependencies {
  reader: JobPageReader
  ai: Pick<AIService, 'start' | 'cancel'>
  extractor?: (owner: number, choice: AIChoice) => JobExtractor
}
const startInput = v.object({ url: v.url, choice: v.object({ providerId: v.text(100, 1), modelId: v.text(200, 1) }) })

/** Tasks and source text live only in memory. Saving remains an explicit business API call. */
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
  async function run(taskId: string, task: Task, url: string, choice: AIChoice) {
    try {
      emit(taskId, task, { taskId, type: 'phase', phase: 'reading' })
      const snapshot = await deps.reader.read(url, task.controller.signal)
      task.controller.signal.throwIfAborted()
      emit(taskId, task, { taskId, type: 'phase', phase: 'parsing' })
      const extractor = deps.extractor?.(task.owner, choice) ?? createJobExtractor(deps.ai, task.owner, choice)
      const details = await extractor.extract(snapshot, task.controller.signal)
      task.controller.signal.throwIfAborted()
      emit(taskId, task, { taskId, type: 'ready', draft: { details, source: { url: snapshot.requestedUrl,
        platform: new URL(snapshot.url).hostname, externalId: '', pageTitle: snapshot.pageTitle,
        cleanedContent: [snapshot.cleanedContent, snapshot.jobPosting.length ? JSON.stringify(snapshot.jobPosting) : ''].filter(Boolean).join('\n\n') } } })
    } catch (error) {
      if (!task.controller.signal.aborted) emit(taskId, task, { taskId, type: 'failed', error: error instanceof JobImportFailure ? error.code : aiError(error) })
    } finally { tasks.delete(taskId) }
  }
  return {
    start(owner: number, input: unknown, callback: (event: JobImportEvent) => void) {
      const args = startInput(input)
      if (tasks.size >= 16 || [...tasks.values()].some(task => task.owner === owner)) fail('AI_PROVIDER_FAILED')
      const taskId = randomUUID(), task: Task = { owner, controller: new AbortController(), emit: callback }
      tasks.set(taskId, task)
      setImmediate(() => { if (tasks.get(taskId) === task) void run(taskId, task, args.url, args.choice) })
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
