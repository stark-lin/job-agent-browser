import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { seed, value } from './helpers'
import { createJobAgentTooling, jobAgentAllowlist } from '../src/platform/tools'
import type { ToolOutput } from '../src/shared/tools/tool.types'

export const data = <T>(output: ToolOutput) => output.structuredContent as unknown as T
export async function resumeTools(t: Parameters<typeof seed>[0]) {
  const f = await seed(t), tooling = createJobAgentTooling(f.backend, async () => ({ output: { status: 'READY' } }))
  t.after(() => tooling.dispose())
  const scope = tooling.registry.scope({ allow: jobAgentAllowlist, maxRisk: 'WRITE' }, { agentId: 'codex', signal: new AbortController().signal })
  t.after(() => scope.dispose())
  const requestId = randomUUID(), start = { requestId, jobId: f.job.id, profileId: f.profile.id }
  const { runId } = data<{ runId: string }>(await scope.execute('resume.start', start))
  return { ...f, tooling, scope, start, runId }
}
test('shared tools freeze reads, isolate model scope, audit trusted identity and retry creation exactly once', async t => {
  const f = await resumeTools(t)
  assert.equal(data<{ runId: string }>(await f.scope.execute('resume.start', f.start)).runId, f.runId)
  assert.equal(f.backend.resumes.listRuns({}).total, 1)
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, targetWordCount: 600 }), { code: 'TOOL_CONFLICT' })
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'LIVE CHANGE' } }))
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'LIVE CHANGE' } }))
  const context = data<{ profile: { name: string }; factCount: number }>(await f.scope.execute('resume.get_context', { runId: f.runId }))
  const facts = data<{ items: { content: string }[]; total: number }>(await f.scope.execute('resume.list_facts', { runId: f.runId, limit: 1 }))
  assert.equal(context.profile.name, f.profile.name); assert.equal(context.factCount, 1)
  assert.equal(facts.items[0].content, f.fact.content)
  assert.equal(data<{ items: unknown[] }>(await f.scope.execute('resume.list_facts', { runId: f.runId, offset: 1 })).items.length, 0)
  const read = f.tooling.registry.scope({ allow: ['resume.get_context', 'resume.list_facts'], maxRisk: 'READ' }, { agentId: 'resume', runId: f.runId, signal: new AbortController().signal })
  await assert.rejects(read.execute('resume.publish', { runId: f.runId }), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(read.execute('resume.get_context', { runId: randomUUID() }), { code: 'TOOL_FORBIDDEN' })
  read.dispose()
  const audit = f.backend.toolAudit.list()
  assert(audit.some(row => row.run_id === f.runId && row.agent_id === 'codex'))
  assert(!JSON.stringify(audit).includes(f.fact.content))
})
test('workflow rejects skipped stages and provenance forgery, handles identical retries and publishes once', async t => {
  const f = await resumeTools(t), call = (name: string, args = {}) => f.scope.execute(name, { runId: f.runId, ...args })
  await assert.rejects(call('resume.publish'), { code: 'TOOL_CONFLICT' })
  const scoring = { language: 'en', scores: [{ factId: f.fact.id, score: 90, reason: 'Relevant' }] }
  await call('resume.submit_scores', scoring); await call('resume.submit_scores', scoring)
  await call('resume.submit_scores', { language: 'en', scores: [{ reason: 'Relevant', score: 90, factId: f.fact.id }] })
  await assert.rejects(call('resume.submit_scores', { language: 'en', scores: [{ reason: ' Relevant ', score: 90, factId: f.fact.id }] }), { code: 'TOOL_CONFLICT' })
  await assert.rejects(call('resume.submit_scores', { ...scoring, language: 'zh-CN' }), { code: 'TOOL_CONFLICT' })
  await call('resume.submit_gate', { gate: { passed: true, reason: '', missingRequirements: [] } })
  await call('resume.submit_selection', { selection: { factIds: [f.fact.id], itemIds: [f.item.id], wordBudget: 500 } })
  const writing = { summary: { id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] }, experience: [], projects: [], education: [], skills: [] }
  await assert.rejects(call('resume.submit_draft', { writing: { ...writing, basics: { name: 'FORGED' } } }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('resume.submit_draft', { writing: { ...writing, summary: { ...writing.summary, factIds: [randomUUID()] } } }), { code: 'TOOL_CONFLICT' })
  await call('resume.submit_draft', { writing }); await call('resume.submit_polished', { writing })
  const first = data<{ artifact: { id: string; content: { basics: { name: string } } } }>(await call('resume.publish'))
  const second = data<{ artifact: { id: string } }>(await call('resume.publish'))
  assert.equal(second.artifact.id, first.artifact.id); assert.equal(first.artifact.content.basics.name, f.profile.name)
  assert.deepEqual(f.backend.resumes.getArtifact({ id: first.artifact.id }).provenance, [{ blockId: writing.summary.id, factIds: [f.fact.id] }])
})
test('gate rejection is terminal and cancellation is idempotent', async t => {
  const f = await resumeTools(t)
  await f.scope.execute('resume.submit_scores', { runId: f.runId, language: 'en', scores: [{ factId: f.fact.id, score: 10, reason: '' }] })
  const gate = { runId: f.runId, gate: { passed: false, reason: 'Missing evidence', missingRequirements: ['Leadership'] } }
  await f.scope.execute('resume.submit_gate', gate); await f.scope.execute('resume.submit_gate', gate)
  await assert.rejects(f.scope.execute('resume.publish', { runId: f.runId }), { code: 'TOOL_CONFLICT' })
  const stopped = data<{ status: string }>(await f.scope.execute('resume.cancel', { runId: f.runId }))
  assert.equal(stopped.status, 'FAILED'); assert.equal(f.backend.artifactForRun(f.runId), null)
})
test('oversized snapshots are rejected before creation and bounded score submissions can exceed the generic 64 KiB limit', async t => {
  const f = await resumeTools(t)
  for (let i = 0; i < 150; i++) value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: `Fact ${i}` } }))
  const next = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const run = f.backend.resumes.getRun({ id: next.runId }).run
  const input = { runId: next.runId, language: 'en', scores: run.inputSnapshot.facts.map(fact => ({ factId: fact.id, score: 90, reason: 'R'.repeat(512) })) }
  assert(Buffer.byteLength(JSON.stringify(input)) > 65536)
  await f.scope.execute('resume.submit_scores', input)
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'X'.repeat(9000) } }))
  const before = f.backend.resumes.listRuns({}).total
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.backend.resumes.listRuns({}).total, before)
})

test('a dense but valid writing payload is rejected before persistence when its provenance view exceeds result capacity', async t => {
  const f = await resumeTools(t)
  for (let i = 0; i < 39; i++) value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: `Evidence ${i}` } }))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const facts = f.backend.resumes.getRun({ id: runId }).run.inputSnapshot.facts
  await f.scope.execute('resume.submit_scores', { runId, language: 'en', scores: facts.map(fact => ({ factId: fact.id, score: 80, reason: '' })) })
  await f.scope.execute('resume.submit_gate', { runId, gate: { passed: true, reason: '', missingRequirements: [] } })
  await f.scope.execute('resume.submit_selection', { runId, selection: { factIds: facts.map(fact => fact.id), itemIds: [f.item.id], wordBudget: 500 } })
  const writing = { summary: null, experience: [], projects: [], education: [], skills: Array.from({ length: 200 }, () => ({ id: randomUUID(), text: 'Saved evidence', factIds: facts.map(fact => fact.id) })) }
  assert(Buffer.byteLength(JSON.stringify({ runId, writing })) < 524288)
  await assert.rejects(f.scope.execute('resume.submit_draft', { runId, writing }), { code: 'TOOL_INVALID_INPUT' })
  const run = f.backend.resumes.getRun({ id: runId }).run
  assert.equal(run.draft, null); assert.equal(run.stage, 'draft')
})
