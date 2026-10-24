import test from 'node:test'
import assert from 'node:assert/strict'
import { firstPartyFixture } from './first-party-fixture'
import { createApplicationTasks } from '../src/platform/electron/application-tasks'
import type { ApplicationTask } from '../src/platform/electron/application-contract'
import type { ApplicationPlan } from '../src/domain/application/application.types'
import type { AgentModel } from '../src/shared/agent'
import { DataError } from '../src/domain/common/errors'

async function waitTask(tasks: ReturnType<typeof createApplicationTasks>, taskId: string): Promise<ApplicationTask> {
  const until = Date.now() + 5000
  for (;;) {
    const task = tasks.getTask(1, { taskId })
    if (!['planning', 'executing'].includes(task.state)) return task
    if (Date.now() > until) throw new Error('Application task timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('application Agent reads current state, asks before ambiguous dates, and executes the clarified instruction through real MCP', async t => {
  const f = await firstPartyFixture(t), prompts: string[] = []
  let calls = 0
  const model: AgentModel = { complete: async input => {
    prompts.push(input.messages[0].content)
    const plan: ApplicationPlan = ++calls === 1 ? { question: 'Which date and time?', actions: [] }
      : { question: '', actions: [{ type: 'set_status', status: 'APPLIED' }, { type: 'add_note', text: 'Recruiter called' },
        { type: 'schedule_event', eventType: 'INTERVIEW', title: 'Interview', description: '', startsAt: '2026-10-27T03:00:00.000Z', endsAt: null }] }
    return { content: JSON.stringify(plan), toolCalls: [] }
  } }
  const tasks = createApplicationTasks({ mcp: f.mcp, model: () => model })
  t.after(() => tasks.dispose())
  const { taskId } = tasks.start(1, { jobId: f.job.id, instruction: 'Mark applied, add the recruiter note and schedule the interview.' })
  let task = await waitTask(tasks, taskId)
  assert.equal(task.state, 'waiting'); assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 0)
  assert.throws(() => tasks.reply(2, { taskId, answer: 'Tuesday at 14:00 Sydney' }), { code: 'FORBIDDEN' })
  tasks.reply(1, { taskId, answer: '27 October at 14:00 Sydney' })
  task = await waitTask(tasks, taskId)
  assert.equal(task.state, 'succeeded'); assert(task.results.every(result => result.state === 'succeeded'))
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).applicationStatus, 'APPLIED')
  const events = f.backend.applications.listEvents({ jobId: f.job.id })
  assert.equal(events.total, 3); assert(events.items.some(event => event.startsAt === '2026-10-27T03:00:00.000Z'))
  assert(prompts.every(prompt => prompt.includes('"allowedNextStatuses"') && prompt.includes('"status":"NOT_STARTED"')))
  assert(prompts[1].includes('27 October at 14:00 Sydney'))
  const audit = f.backend.toolAudit.list()
  const firstWrite = audit.findIndex(row => row.mode === 'write')
  assert(firstWrite > 0); assert(audit.slice(0, firstWrite).every(row => row.mode === 'read'))
  assert(audit.every(row => row.agent_id === 'internal.application'))
})

test('application partial failure reports completed actions and retries only unfinished writes without repeating model reasoning', async t => {
  const f = await firstPartyFixture(t)
  let modelCalls = 0
  const tasks = createApplicationTasks({ mcp: f.mcp, model: () => ({ complete: async () => {
    modelCalls++
    return { content: JSON.stringify({ question: '', actions: [{ type: 'add_note', text: 'One durable note' }, { type: 'set_status', status: 'ACCEPTED' }] }), toolCalls: [] }
  } }) })
  t.after(() => tasks.dispose())
  const { taskId } = tasks.start(1, { jobId: f.job.id, instruction: 'Record a note and accept the offer' })
  let task = await waitTask(tasks, taskId)
  assert.equal(task.state, 'failed'); assert.deepEqual(task.results.map(result => result.state), ['succeeded', 'failed'])
  for (const status of ['APPLIED', 'OFFER']) f.backend.applications.changeStatus({ jobId: f.job.id, status })
  tasks.retry(1, { taskId }); task = await waitTask(tasks, taskId)
  assert.equal(task.state, 'succeeded'); assert.equal(modelCalls, 1)
  const notes = f.backend.applications.listEvents({ jobId: f.job.id }).items.filter(event => event.type === 'NOTE')
  assert.equal(notes.length, 1)
})

test('invalid model actions cannot switch jobs or forge event ownership; cancellation suppresses late reasoning', async t => {
  const f = await firstPartyFixture(t)
  let response = { question: '', actions: [{ type: 'set_status', status: 'APPLIED', jobId: f.profile.id }] } as unknown
  const tasks = createApplicationTasks({ mcp: f.mcp, model: () => ({ complete: async () => ({ content: JSON.stringify(response), toolCalls: [] }) }) })
  t.after(() => tasks.dispose())
  let id = tasks.start(1, { jobId: f.job.id, instruction: 'Apply' }).taskId
  assert.equal((await waitTask(tasks, id)).state, 'failed')
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).applicationStatus, 'NOT_STARTED')
  const other = f.backend.jobs.saveJob({ details: { title: 'Other', companyNameRaw: 'Other' } })
  const foreign = f.backend.applications.scheduleEvent({ jobId: other.id, type: 'INTERVIEW', title: 'Other', startsAt: '2026-10-27T03:00:00.000Z' })
  response = { question: '', actions: [{ type: 'reschedule_event', eventId: foreign.id, startsAt: '2026-10-28T03:00:00.000Z', endsAt: null }] }
  id = tasks.start(1, { jobId: f.job.id, instruction: 'Move interview' }).taskId
  assert.equal((await waitTask(tasks, id)).results[0].error, 'TOOL_FORBIDDEN')
  let started = false, release!: (value: { content: string; toolCalls: [] }) => void
  const hanging = createApplicationTasks({ mcp: f.mcp, model: () => ({ complete: () => { started = true; return new Promise(resolve => { release = resolve }) } }) })
  t.after(() => hanging.dispose())
  id = hanging.start(1, { jobId: f.job.id, instruction: 'Add note' }).taskId
  for (let n = 0; n < 300 && !started; n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert(started); hanging.cancel(1, { taskId: id })
  release({ content: JSON.stringify({ question: '', actions: [{ type: 'add_note', text: 'Late' }] }), toolCalls: [] })
  assert.equal((await waitTask(hanging, id)).state, 'cancelled')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 0)
  assert.throws(() => tasks.start(3, { jobId: f.job.id, instruction: '' }), DataError)
})
