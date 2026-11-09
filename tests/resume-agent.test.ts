import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { value } from './helpers'
import { createResumeTasks } from '../src/platform/electron/resume-tasks'
import { resumeFixture } from './resume-fixture'
import { firstPartyFixture } from './first-party-fixture'
import type { ResumeEvent } from '../src/platform/electron/resume-contract'
import { applyResumeTraceEvent } from '../src/pages/tailor-resume/resume-trace'
import { ToolError } from '../src/shared/tools/errors'
import { DataError } from '../src/domain/common/errors'
import type { StreamingAgentModel } from '../src/shared/agent'
import { en } from '../src/shared/i18n/locales/en'
import { zhCN } from '../src/shared/i18n/locales/zh-CN'

async function setup(t: TestContext, batchSize = 1, model?: StreamingAgentModel) {
  const f = await firstPartyFixture(t), server = await resumeFixture(batchSize)
  t.after(() => server.close())
  const events: ResumeEvent[] = []
  const tasks = createResumeTasks({ backend: f.backend, mcp: f.mcp, directory: f.outputDirectory, fonts: '', key: () => null,
    settings: () => ({ default: { providerId: 'fixture', modelId: 'fixture' }, providers: [{ id: 'fixture', name: 'Fixture', baseURL: server.url, models: ['fixture'], defaultModel: 'fixture', requiresKey: false }] }),
    ...(model ? { model: () => model } : {}) })
  t.after(() => tasks.dispose())
  return { ...f, server, tasks, events, directory: f.outputDirectory, outputCount: f.outputs,
    failOutput: (value: boolean) => f.flag('fail-output', value),
    start: () => tasks.start(1, { jobId: f.job.id, profileId: f.profile.id }, event => events.push(event)) }
}
async function done(tasks: ReturnType<typeof createResumeTasks>, runId: string) {
  const until = Date.now() + 5000
  for (;;) {
    const task = tasks.getTask(1, { runId })!
    if (!task.active) return task
    if (Date.now() > until) throw new Error('Timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
test('fixture executes all stages, audits calls, publishes immutable evidence and outputs; retry never calls the model', async t => {
  const f = await setup(t)
  value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'OTHER', content: 'Second supported claim' } }))
  const { runId } = await f.start()
  await assert.rejects(f.start, { code: 'INVALID_STATE' })
  await assert.rejects(f.tasks.cancel(2, { runId }), { code: 'FORBIDDEN' })
  const result = await done(f.tasks, runId)
  assert.equal(result.run.state, 'PUBLISHED'); assert.equal(result.artifact?.content.language, 'en'); assert.equal(result.artifact?.output.status, 'READY')
  assert(result.run.assembled)
  assert.equal(f.backend.rewrittenBulletIds(runId).length, 2)
  const trace = f.tasks.getTrace(1, { runId })!
  assert.equal(trace.run.sessionId, null)
  assert.equal(trace.run.state, 'completed')
  assert.equal(trace.cycles.length, 4)
  assert.equal(trace.requests.length, 4)
  assert(trace.items.some(item => item.content.type === 'tool_call' && item.content.toolName === 'resume.rewrite_bullet'))
  assert.equal(result.artifact?.outputFiles.length, 2)
  assert.equal(f.server.requests(), 4)
  assert.equal(f.database.connection.prepare("SELECT count(*) n FROM audit_logs WHERE event_type='AGENT_MODEL_RESULT' AND status='SUCCESS'").get()?.n, 4)
  assert(f.database.connection.prepare("SELECT count(*) n FROM capability_audit WHERE agent_id='internal.resume'").get()!.n as number > 0)
  assert(f.events.every((event, index) => event.sequence === index + 1 && event.runId === runId))
  const before = f.server.requests()
  await f.tasks.retryOutput(1, { artifactId: result.artifact!.id }, event => f.events.push(event)); await done(f.tasks, runId)
  assert.equal(f.server.requests(), before); assert.equal(f.outputCount(), 2)
  assert.equal((await f.tasks.getPreview({ artifactId: result.artifact!.id })).pages, 1)
})
test('desktop model batches independent rewrites without revision bookkeeping or conflict recovery', async t => {
  const f = await setup(t, 2)
  value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'OTHER', content: 'Second supported claim' } }))
  const { runId } = await f.start(), result = await done(f.tasks, runId)
  assert.equal(result.run.state, 'PUBLISHED')
  assert.equal(f.backend.rewrittenBulletIds(runId).length, 2)
  const trace = f.tasks.getTrace(1, { runId })!
  const writes = trace.items.filter(item => item.content.type === 'tool_call' && item.content.toolName === 'resume.rewrite_bullet')
  assert.equal(writes.length, 2)
  assert(writes.every(item => item.state === 'completed'))
  assert.equal(f.server.requests(), 3)
})

test('generation preserves grouped skills, copied introduction and standalone skill categories', async t => {
  const f = await setup(t)
  const introduction = 'Backend developer with saved project experience.'
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: f.profile.name, introduction } }))
  const grouped = 'Backend skills: SQLite / Go / REST APIs'
  const attached = value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id,
    details: { kind: 'SKILL', content: grouped } }))
  const skills = [grouped, 'Frontend skills: React, TypeScript']
  for (const content of skills) value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content } }))
  const result = await done(f.tasks, (await f.start()).runId)
  assert.equal(result.run.state, 'PUBLISHED')
  const content = result.artifact!.content
  assert.equal(content.summary?.text, introduction)
  assert.deepEqual(content.skills.map(skill => skill.text), skills)
  assert.equal(content.experience[0].bullets.length, 2)
  assert.equal(content.experience[0].bullets[1].text, grouped + '.')
  assert.deepEqual(content.experience[0].bullets[1].factIds, [attached.id])
})

for (const [failure, expected] of [
  [new ToolError('TOOL_EXECUTION_FAILED'), 'TOOL_EXECUTION_FAILED'],
  [new ToolError('TOOL_INVALID_OUTPUT'), 'TOOL_INVALID_OUTPUT'],
  [new DataError('STORAGE_UNAVAILABLE'), 'STORAGE_UNAVAILABLE'],
  [new Error('private failure details'), 'GENERATION_FAILED']
] as const) test(`generation retains ${expected} through Agent settlement and real MCP failure reporting`, async t => {
  const f = await setup(t, 1, { async *stream() { throw failure }, async complete() { throw failure } })
  const result = await done(f.tasks, (await f.start()).runId)
  assert.equal(result.run.state, 'FAILED')
  assert.equal(result.run.error, expected)
  assert.equal(result.artifact, null)
  assert.equal(f.outputCount(), 0)
  const trace = f.tasks.getTrace(1, { runId: result.run.id })!
  assert.equal(trace.run.error, expected)
  assert.equal(trace.cycles.at(-1)?.status, 'FAILED')
  assert(!JSON.stringify(trace).includes('private failure details'))
  assert(en.resume.errors[expected]); assert(zhCN.resume.errors[expected])
})

test('live trace streams partial text, recovers from a sequence gap and preserves cancelled diagnostics', async t => {
  const f = await setup(t)
  let send: ((text: string) => void) | undefined
  f.server.hook((_stage, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    send = text => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
    send('Reviewing')
    return true
  })
  const { runId } = await f.start()
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
    throw new Error('Timed out waiting for live trace')
  }
  await waitFor(() => f.events.some(event => event.trace?.type === 'item.delta'))
  const initial = f.tasks.getTrace(1, { runId })!
  assert.equal(initial.run.state, 'running')
  const initialContent = initial.items.at(-1)!.content
  assert.equal(initialContent.type === 'assistant_message' && initialContent.text, 'Reviewing')
  // Snapshot readers cannot mutate the recorder's in-memory state.
  initial.run.error = 'mutated'
  assert.equal(f.tasks.getTrace(1, { runId })!.run.error, null)
  const sequence = initial.run.eventSequence
  send!(' source bullets')
  await waitFor(() => f.events.some(event => event.trace?.type === 'item.delta' && event.trace.eventSequence > sequence))
  const delta = f.events.find(event => event.trace?.type === 'item.delta' && event.trace.eventSequence > sequence)!.trace!
  const updated = applyResumeTraceEvent(initial, delta)!
  const updatedContent = updated.items.at(-1)!.content
  assert.equal(updatedContent.type === 'assistant_message' && updatedContent.text, 'Reviewing source bullets')
  assert.equal(applyResumeTraceEvent(updated, delta), updated)
  assert.equal(applyResumeTraceEvent(initial, { ...delta, eventSequence: sequence + 2 }), null)
  const recovered = f.tasks.getTrace(1, { runId })!
  assert.equal(applyResumeTraceEvent(recovered, delta), recovered)
  assert.equal(f.tasks.getTask(1, { runId })!.active, true)
  await assert.rejects(async () => f.tasks.getTrace(2, { runId }), { code: 'FORBIDDEN' })
  await f.tasks.cancel(1, { runId })
  const terminal = f.tasks.getTrace(1, { runId })!
  assert.equal(terminal.run.state, 'cancelled')
  assert.equal(terminal.items.at(-1)?.state, 'cancelled')
  assert(f.events.some(event => event.trace?.type === 'run.cancelled'))
  assert(f.events.every((event, index) => event.sequence === index + 1))
})

test('cancellation during a hanging model call and owner disposal cannot publish late results', async t => {
  const f = await setup(t)
  f.server.hook((stage) => stage === 'rewrite')
  const { runId } = await f.start()
  for (let i = 0; i < 300 && f.server.requests() === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert(f.server.requests() > 0)
  f.tasks.disposeOwner(1)
  const result = await done(f.tasks, runId)
  assert.equal(result.run.state, 'CANCELLED'); assert.equal(result.artifact, null)
  assert.equal(value(await f.api.resumes.getRun({ id: runId })).run.state, 'CANCELLED')
})
test('post-publication output failure preserves SUCCEEDED and supports model-free rebuilding', async t => {
  const f = await setup(t); f.failOutput(true)
  const result = await done(f.tasks, (await f.start()).runId)
  assert.equal(result.run.state, 'PUBLISHED'); assert.equal(result.artifact?.output.status, 'FAILED')
  const calls = f.server.requests(); f.failOutput(false)
  await f.tasks.retryOutput(1, { artifactId: result.artifact!.id }, () => {})
  assert.equal((await done(f.tasks, result.run.id)).artifact?.output.status, 'READY'); assert.equal(f.server.requests(), calls)
})
test('invalid provider stream fails once without an implicit repair loop', async t => {
  const f = await setup(t)
  f.server.hook((stage, response) => {
    if (stage !== 'rewrite') return false
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] })); return true
  })
  const result = await done(f.tasks, (await f.start()).runId)
  assert.equal(result.run.state, 'FAILED'); assert.equal(result.run.error, 'AGENT_PROTOCOL_ERROR'); assert.equal(f.server.requests(), 1)
})

test('live profile changes after start do not alter tool reads or generated basics/evidence', async t => {
  const f = await setup(t), { runId } = await f.start()
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'CHANGED LIVE' } }))
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'CHANGED LIVE' } }))
  const result = await done(f.tasks, runId)
  assert.equal(result.artifact?.content.basics.name, f.profile.name)
  assert.equal(result.artifact?.content.experience[0].bullets[0].text, f.fact.content + '.')
  const audit = value(await f.api.audit.list({ limit: 100 }))
  assert(!JSON.stringify(audit).includes(f.fact.content))
})
test('cancelling at publish boundary prevents Artifact creation and terminal state occurs once', async t => {
  const f = await setup(t)
  const { runId } = await f.tasks.start(1, { jobId: f.job.id, profileId: f.profile.id }, event => {
    if (event.state === 'VALIDATING') void f.tasks.cancel(1, { runId: event.runId })
  })
  const result = await done(f.tasks, runId)
  assert.equal(result.run.state, 'CANCELLED'); assert.equal(result.artifact, null)
  const audits = value(await f.api.audit.list({ targetId: runId, limit: 100 }))
  assert.equal(audits.items.filter(row => row.eventType === 'GENERATION_CANCEL' && row.status === 'SUCCESS').length, 1)
})
test('missing recorded output becomes a recoverable output failure and rebuild does not call the model', async t => {
  const f = await setup(t), result = await done(f.tasks, (await f.start()).runId)
  const html = result.artifact!.outputFiles.find(file => file.format === 'HTML')!
  rmSync(join(f.directory, html.relativePath))
  await assert.rejects(f.tasks.getPreview({ artifactId: result.artifact!.id }), /OUTPUT_MISSING/)
  assert.equal(f.tasks.getTask(1, { runId: result.run.id })?.artifact?.output.status, 'FAILED')
  const calls = f.server.requests()
  await f.tasks.retryOutput(1, { artifactId: result.artifact!.id }, () => {}); await done(f.tasks, result.run.id)
  assert.equal(f.server.requests(), calls)
})
test('post-publication cancellation bounds a late output worker and preserves the successful Artifact', async t => {
  const f = await setup(t)
  f.flag('hang-output')
  const { runId } = await f.start()
  for (let i = 0; i < 1000 && !f.has('rendering'); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert(f.has('rendering')); await f.tasks.cancel(1, { runId })
  const result = await done(f.tasks, runId)
  assert.equal(result.run.state, 'PUBLISHED'); assert.equal(result.artifact?.output.status, 'CANCELLED')
  f.flag('release-output'); await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.tasks.getTask(1, { runId })?.artifact?.outputFiles.length, 0)
})

test('unavailable tool audit stops ResumeAgent immediately without draft or publication', async t => {
  const f = await setup(t)
  f.flag('fail-audit-start')
  await assert.rejects(f.start(), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  assert.equal(f.backend.resumes.listRuns({}).total, 0); assert.equal(f.server.requests(), 0)
})

test('uncertain start audit is recovered without an unowned active task', async t => {
  const f = await setup(t)
  f.flag('fail-audit-finish')
  await assert.rejects(f.start(), { code: 'TOOL_AUDIT_UNAVAILABLE' })
  f.backend.recover()
  const run = f.backend.resumes.listRuns({}).items[0].run
  assert.equal(run.state, 'INTERRUPTED'); assert.equal(run.error, 'PROCESS_INTERRUPTED'); assert.equal(f.server.requests(), 0)
})

test('maximum-length valid contact and job titles do not fail publication or change copied basics', async t => {
  const f = await setup(t), name = 'N'.repeat(300), title = 'J'.repeat(500)
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name } }))
  value(await f.api.jobs.updateDetails({ id: f.job.id, details: { title, companyNameRaw: 'Fixture' } }))
  const result = await done(f.tasks, (await f.start()).runId)
  assert.equal(result.run.state, 'PUBLISHED')
  assert.equal(result.artifact?.title.length, 500)
  assert.equal(result.artifact?.content.basics.name, name)
  assert.equal(result.run.inputSnapshot.job.title, title)
})

test('an unavailable first-party stdio entry cannot fall back to local generation or tools', async t => {
  const f = await setup(t)
  rmSync(join(f.directory, '..', 'job-agent-mcp.js'))
  await assert.rejects(f.start(), { code: 'MCP_CONNECT_FAILED' })
  assert.equal(f.backend.resumes.listRuns({}).total, 0)
  assert.equal(f.server.requests(), 0)
  assert.equal(f.outputCount(), 0)
})
