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
test('optimization rejects forged data, handles identical retries and publishes once', async t => {
  const f = await resumeTools(t), call = (name: string, args = {}) => f.scope.execute(name, { runId: f.runId, ...args })
  await assert.rejects(call('resume.publish'), { code: 'TOOL_CONFLICT' })
  const optimization = { language: 'en', summary: { text: f.fact.content, factIds: [f.fact.id] }, entries: [], skills: [] }
  await assert.rejects(call('resume.submit_optimization', { optimization: { ...optimization, basics: { name: 'FORGED' } } }), { code: 'TOOL_INVALID_INPUT' })
  await assert.rejects(call('resume.submit_optimization', { optimization: { ...optimization, summary: { ...optimization.summary, factIds: [randomUUID()] } } }), { code: 'TOOL_CONFLICT' })
  const accepted = await call('resume.submit_optimization', { optimization })
  const assembled = f.backend.resumes.getRun({ id: f.runId }).run.assembled!
  assert.deepEqual(await call('resume.submit_optimization', { optimization }), accepted)
  await assert.rejects(call('resume.submit_optimization', { optimization: { ...optimization, language: 'zh-CN' } }), { code: 'TOOL_CONFLICT' })
  const first = data<{ artifact: { id: string; content: { basics: { name: string } } } }>(await call('resume.publish'))
  const second = data<{ artifact: { id: string } }>(await call('resume.publish'))
  assert.equal(second.artifact.id, first.artifact.id); assert.equal(first.artifact.content.basics.name, f.profile.name)
  assert.deepEqual(f.backend.resumes.getArtifact({ id: first.artifact.id }).provenance, [{ blockId: assembled.summary!.id, factIds: [f.fact.id] }])
})

test('imported entries with empty titles survive assembly and publication unchanged', async t => {
  const f = await resumeTools(t)
  const types = ['EDUCATION', 'EXPERIENCE', 'PROJECT'] as const
  const imported = value(await f.api.profiles.applyImport({ sessionId: randomUUID(), batchId: randomUUID(), profileId: f.profile.id,
    contact: {}, links: [], items: types.map(type => ({ draftId: randomUUID(), details: { type, title: '', organization: `Saved ${type}`,
      metadata: type === 'EDUCATION' ? { degree: 'Bachelor of Computer Science', isCurrent: true } : {} } })), facts: [] }))
  const attached = await Promise.all(imported.items.map(item => f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: item.id,
    details: { kind: 'OTHER', content: `Saved ${item.type} evidence` } }).then(value)))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const call = (name: string, args = {}) => f.scope.execute(name, { runId, ...args })
  const entries = (type: typeof types[number]) => imported.items.filter(item => item.type === type).map(item => {
    const fact = attached.find(fact => fact.profileItemId === item.id)!
    return { profileItemId: item.id, bullets: [{ text: fact.content, factIds: [fact.id] }] }
  })
  const optimization = { language: 'en', summary: null, entries: types.flatMap(entries), skills: [] }
  await call('resume.submit_optimization', { optimization })
  const { artifact } = data<{ artifact: { content: { education: { title: string; organization: string; degree: string }[];
    experience: { title: string }[]; projects: { title: string }[] } } }>(await call('resume.publish'))
  assert.equal(artifact.content.education[0].title, '')
  assert.equal(artifact.content.education[0].organization, 'Saved EDUCATION')
  assert.equal(artifact.content.education[0].degree, 'Bachelor of Computer Science')
  assert.equal(artifact.content.experience[0].title, '')
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

test('dense optimization is rejected before persistence when its provenance exceeds result capacity', async t => {
  const f = await resumeTools(t)
  for (let i = 0; i < 60; i++) value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: `Evidence ${i}` } }))
  const { runId } = data<{ runId: string }>(await f.scope.execute('resume.start', { ...f.start, requestId: randomUUID() }))
  const facts = f.backend.resumes.getRun({ id: runId }).run.inputSnapshot.facts.filter(fact => fact.kind === 'SKILL')
  const optimization = { language: 'en', summary: null, entries: [], skills: Array.from({ length: 200 }, () => ({ text: 'Evidence', factIds: facts.map(fact => fact.id) })) }
  assert(Buffer.byteLength(JSON.stringify({ runId, optimization })) < 524288)
  await assert.rejects(f.scope.execute('resume.submit_optimization', { runId, optimization }), { code: 'TOOL_INVALID_INPUT' })
  const run = f.backend.resumes.getRun({ id: runId }).run
  assert.equal(run.assembled, null); assert.equal(run.stage, 'optimize')
})
