import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import type { AgentModel } from '../../shared/agent'
import type { ApplicationAction } from '../../domain/application/application.types'
import type { ApplicationTask } from './application-contract'
import type { FirstPartyRuntime, MCPAgentTools } from '../mcp/first-party-client'
import { runApplicationAgent } from '../agent/application'
import { resumeError } from './resume-tasks'

interface Task {
  owner: number; view: ApplicationTask; instruction: string; answers: { question: string; answer: string }[]
  model: AgentModel; controller: AbortController; tools?: MCPAgentTools; actions: ApplicationAction[]; requestIds: string[]; done?: Promise<void>
}
const running = (task: Task) => ['planning', 'executing'].includes(task.view.state)
/** Fixed action executor binds every model-produced action to the selected Job. */
export function createApplicationTasks(deps: { mcp: FirstPartyRuntime; model(): AgentModel }) {
  const tasks = new Map<string, Task>()
  let disposed = false
  function owned(owner: number, input: unknown) {
    const { taskId } = v.object({ taskId: v.id })(input), task = tasks.get(taskId)
    if (!task) fail('NOT_FOUND')
    if (task.owner !== owner) fail('FORBIDDEN')
    return task
  }
  async function execute(task: Task) {
    const tools = task.tools!, jobId = task.view.jobId, signal = AbortSignal.any([task.controller.signal, tools.signal])
    task.view.state = 'executing'; task.view.error = null
    for (const [index, action] of task.actions.entries()) {
      if (task.view.results[index].state === 'succeeded') continue
      signal.throwIfAborted()
      const { type, ...fields } = action
      let name: string, args: object
      if (type === 'set_status') { name = 'application.set_status'; args = { jobId, ...fields } }
      else if (type === 'add_note') { name = 'application.add_note'; args = { jobId, ...fields, requestId: task.requestIds[index] } }
      else if (action.type === 'schedule_event') {
        name = 'application.schedule_event'
        const { type: _type, eventType, ...value } = action
        args = { jobId, ...value, type: eventType, requestId: task.requestIds[index] }
      } else if (action.type === 'reschedule_event') { name = 'application.reschedule_event'; args = { jobId, id: action.eventId, startsAt: action.startsAt, endsAt: action.endsAt } }
      else if (action.type === 'update_job') { name = 'job.update'; args = { id: jobId, changes: action.changes } }
      else if (action.type === 'set_archived') { name = 'job.set_archived'; args = { id: jobId, archived: action.archived } }
      else return fail('INVALID_INPUT')
      try { await tools.call(name, args, signal); task.view.results[index] = { type, state: 'succeeded', error: null } }
      catch (error) { task.view.results[index] = { type, state: 'failed', error: resumeError(error) }; throw error }
    }
    task.view.state = 'succeeded'; task.view.retryable = false
  }
  function launch(task: Task, replan: boolean) {
    task.done = new Promise(resolve => setImmediate(() => {
      void (async () => {
        task.tools ??= await deps.mcp.session('application', task.controller.signal)
        const signal = AbortSignal.any([task.controller.signal, task.tools.signal])
        if (replan) {
          const plan = await runApplicationAgent(task.model, task.tools.view(['job.get', 'application.get', 'application.list_events'], { jobId: task.view.jobId }),
            { jobId: task.view.jobId, instruction: task.instruction, answers: task.answers, now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, signal)
          signal.throwIfAborted()
          if (plan.question) { task.view.question = plan.question; task.view.state = 'waiting'; return }
          task.actions = plan.actions; task.requestIds = plan.actions.map(() => randomUUID())
          task.view.results = plan.actions.map(action => ({ type: action.type, state: 'pending', error: null }))
        }
        await execute(task)
      })().catch(error => {
        task.view.state = task.controller.signal.aborted ? 'cancelled' : 'failed'; task.view.error = resumeError(error)
        task.view.retryable = !task.controller.signal.aborted && task.actions.length > 0 && !task.tools?.signal.aborted
      }).finally(resolve)
    }))
  }
  return {
    start(owner: number, input: unknown) {
      if (disposed || [...tasks.values()].some(task => task.owner === owner && running(task))) fail('INVALID_STATE')
      const args = v.object({ jobId: v.id, instruction: v.text(10000, 1) })(input), model = deps.model()
      for (const [id, task] of tasks) if (task.owner === owner) { task.controller.abort(); tasks.delete(id) }
      if (tasks.size >= 16) fail('INVALID_STATE')
      const taskId = randomUUID(), task: Task = { owner, view: { taskId, jobId: args.jobId, state: 'planning', question: '', results: [], error: null, retryable: false },
        instruction: args.instruction, model, answers: [], controller: new AbortController(), actions: [], requestIds: [] }
      tasks.set(taskId, task); launch(task, true)
      return { taskId }
    },
    getTask(owner: number, input: unknown) { return structuredClone(owned(owner, input).view) },
    reply(owner: number, input: unknown) {
      const { taskId, answer } = v.object({ taskId: v.id, answer: v.text(10000, 1) })(input), task = owned(owner, { taskId })
      if (disposed || task.view.state !== 'waiting' || task.answers.length >= 8) fail('INVALID_STATE')
      task.answers.push({ question: task.view.question, answer }); task.view.question = ''; task.view.state = 'planning'; launch(task, true)
      return null
    },
    retry(owner: number, input: unknown) {
      const task = owned(owner, input)
      if (disposed || task.view.state !== 'failed' || !task.view.retryable) fail('INVALID_STATE')
      task.view.state = 'executing'; launch(task, false)
      return null
    },
    cancel(owner: number, input: unknown) {
      const task = owned(owner, input); task.controller.abort()
      if (task.view.state !== 'succeeded') { task.view.state = 'cancelled'; task.view.retryable = false }
      return null
    },
    disposeOwner(owner: number) { for (const [id, task] of tasks) if (task.owner === owner) { task.controller.abort(); tasks.delete(id) } },
    async dispose() {
      disposed = true
      for (const task of tasks.values()) task.controller.abort()
      await Promise.allSettled([...tasks.values()].map(task => task.done)); tasks.clear()
    }
  }
}
export type ApplicationTasks = ReturnType<typeof createApplicationTasks>
