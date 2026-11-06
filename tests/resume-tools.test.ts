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
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'LIVE CHANGE', introduction: 'Live introduction' } }))
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'LIVE CHANGE' } }))
  const context = data<{ profile: { name: string; introduction: string }; factCount: number }>(await f.scope.execute('resume.get_context', { runId: f.runId }))
  const facts = data<{ items: { content: string }[]; total: number }>(await f.scope.execute('resume.list_facts', { runId: f.runId, limit: 1 }))
  assert.equal(context.profile.introduction, ''); assert.equal(context.profile.name, f.profile.name); assert.equal(context.factCount, 1)
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
test('rewrite changes only text, preserves provenance and publishes exactly once', async t => {
  const f = await resumeTools(t), call = (name: string, args = {}) => f.scope.execute(name, { runId: f.runId, ...args })
  const before = f.backend.resumes.getRun({ id: f.runId }).run
  const bullet = before.assembled!.experience[0].bullets[0]
  const request = { bulletId: bullet.id, text: 'Supported wording', expectedRevision: 0, requestId: randomUUID() }
  await assert.rejects(call('resume.rewrite_bullet', { ...request, factIds: [] }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('resume.rewrite_bullet', { ...request, bulletId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  const result = await call('resume.rewrite_bullet', request)
  assert.deepEqual(await call('resume.rewrite_bullet', request), result)
  await assert.rejects(call('resume.rewrite_bullet', { ...request, text: 'Different' }), { code: 'TOOL_CONFLICT' })
  await assert.rejects(call('resume.rewrite_bullet', { ...request, requestId: randomUUID() }), { code: 'TOOL_CONFLICT' })
  assert.deepEqual(data(await call('resume.rewrite_bullet', { ...request, expectedRevision: 1, requestId: randomUUID() })),
    { runId: f.runId, bulletId: bullet.id, rewriteRevision: 1, changed: false })
  const after = f.backend.resumes.getRun({ id: f.runId }).run
  assert.equal(after.stateVersion, before.stateVersion)
  assert.equal(after.rewriteRevision, 1)
  bullet.text = request.text
  assert.deepEqual(after.assembled, before.assembled)
  const first = data<{ artifact: { id: string; content: unknown } }>(await call('resume.publish'))
  assert.deepEqual(data(await call('resume.publish')), first)
  assert.deepEqual(first.artifact.content, before.assembled)
  assert.deepEqual(f.backend.resumes.getArtifact({ id: first.artifact.id }).provenance, [{ blockId: bullet.id, factIds: [f.fact.id] }])
  assert.equal(f.backend.resumes.getRun({ id: f.runId }).run.state, 'PUBLISHED')
  await assert.rejects(call('resume.rewrite_bullet', { ...request, expectedRevision: 1, requestId: randomUUID() }), { code: 'TOOL_CONFLICT' })
})

test('imported entries with empty titles survive assembly and publication unchanged', async t => {
  const f = await resumeTools(t)
  const types = ['EDUCATION', 'EXPERIENCE', 'PROJECT'] as const
  const imported = value(await f.api.profiles.applyImport({ sessionId: randomUUID(), batchId: randomUUID(), profileId: f.profile.id,
    contact: {}, links: [], items: types.map(type => ({ draftId: randomUUID(), details: { type, title: '', organization: `Saved ${type}`,
      metadata: type === 'EDUCATION' ? { degree: 'Bachelor of Computer Science', isCurrent: true } : {} } })), facts: [] }))
  await Promise.all(imported.items.map(item => f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: item.id,
    details: { kind: 'OTHER', content: `Saved ${item.type} evidence` } }).then(value)))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const call = (name: string, args = {}) => f.scope.execute(name, { runId, ...args })
  const { artifact } = data<{ artifact: { content: { education: { title: string; organization: string; degree: string }[];
    experience: { title: string }[]; projects: { title: string }[] } } }>(await call('resume.publish'))
  assert.equal(artifact.content.education[0].title, '')
  assert.equal(artifact.content.education[0].organization, 'Saved EDUCATION')
  assert.equal(artifact.content.education[0].degree, 'Bachelor of Computer Science')
  assert.equal(artifact.content.experience[1].title, '')
  assert.equal(artifact.content.projects[0].title, '')
  assert(imported.items.every(item => item.title === ''))
})

test('oversized snapshots are rejected before creation', async t => {
  const f = await resumeTools(t)
  value(await f.api.profiles.editFact({ id: f.fact.id, details: { kind: 'SKILL', content: 'X'.repeat(9000) } }))
  const before = f.backend.resumes.listRuns({}).total
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.backend.resumes.listRuns({}).total, before)
})

test('oversized documents fail the copy atomically', async t => {
  const f = await resumeTools(t)
  const item = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'PROJECT', title: 'Large project' } }))
  for (let i = 0; i < 99; i++) value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: item.id,
    details: { kind: 'OTHER', content: 'X'.repeat(7900) + i } }))
  const before = f.backend.resumes.listRuns({}).total
  await assert.rejects(f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }), { code: 'TOOL_INVALID_INPUT' })
  assert.equal(f.backend.resumes.listRuns({}).total, before)
})
