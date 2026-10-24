import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { seed, published, value } from './helpers'
import { countWords, materializeDocument, documentProvenance, statements } from '../src/domain/resume/document'
import { validateContent, content } from '../src/domain/resume/resume.validation'

test('documents copy basics and item information from snapshot and derive all artifact links from statements', async t => {
  const f = await published(t), current = value(await f.api.resumes.getRun({ id: f.run.id })).run
  assert.deepEqual(f.artifact.content.basics, { name: f.profile.name, email: f.profile.email, phone: f.profile.phone, location: f.profile.location, links: f.profile.links })
  const body = materializeDocument(current.inputSnapshot, 'en', { summary: null, experience: [{ profileItemId: f.item.id, bullets: [{ id: randomUUID(), text: 'Source evidence', factIds: [f.fact.id] }] }], projects: [], education: [], skills: [] })
  validateContent(current, content(body))
  assert.equal(body.experience[0].title, f.item.title)
  assert.deepEqual(documentProvenance(body), statements(body).map(block => ({ blockId: block.id, factIds: block.factIds })))
  const links = f.database.connection.prepare('SELECT block_id, fact_id FROM artifact_facts WHERE artifact_id=?').all(f.artifact.id)
  assert.deepEqual(links.map(link => ({ ...link })), [{ block_id: f.content.summary.id, fact_id: f.fact.id }])
})
test('draft and polish reject empty, foreign, unselected and wrong-item references before persistence', async t => {
  const f = await seed(t)
  const second = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'PROJECT', title: 'Other project' } }))
  const otherFact = value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: second.id, details: { kind: 'SKILL', content: 'SQL' } }))
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }))
  const generation = f.backend.generation
  generation.start({ id: run.id }); generation.recordScores({ id: run.id, language: 'en', scores: run.inputSnapshot.facts.map(fact => ({ factId: fact.id, score: 90, reason: '' })) })
  generation.recordGate({ id: run.id, gate: { passed: true, reason: '', missingRequirements: [] } })
  generation.selectEvidence({ id: run.id, selection: { factIds: [f.fact.id, otherFact.id], itemIds: [f.item.id, second.id], wordBudget: 100 } })
  const body = materializeDocument(run.inputSnapshot, 'en', { summary: { id: randomUUID(), text: 'Supported', factIds: [f.fact.id] }, experience: [], projects: [], education: [], skills: [] })
  for (const factIds of [[], [randomUUID()], [f.fact.id, f.fact.id]]) assert.throws(() => generation.saveDraft({ id: run.id, content: { ...body, summary: { ...body.summary, factIds } } }))
  assert.throws(() => generation.saveDraft({ id: run.id, content: { ...body, basics: { ...body.basics, name: 'Invented' } } }), { code: 'CONFLICT' })
  const wrong = materializeDocument(run.inputSnapshot, 'en', { summary: null, experience: [{ profileItemId: f.item.id, bullets: [{ id: randomUUID(), text: 'SQL', factIds: [otherFact.id] }] }], projects: [], education: [], skills: [] })
  assert.throws(() => generation.saveDraft({ id: run.id, content: wrong }), { code: 'CONFLICT' })
  generation.saveDraft({ id: run.id, content: body })
  assert.throws(() => generation.savePolished({ id: run.id, content: { ...body, summary: { ...body.summary, factIds: [otherFact.id] } } }), { code: 'CONFLICT' })
  assert.throws(() => generation.savePolished({ id: run.id, content: { ...body, summary: { ...body.summary, id: randomUUID() } } }), { code: 'CONFLICT' })
  assert.equal(value(await f.api.resumes.getRun({ id: run.id })).run.polished, null)
})
test('Chinese budget counts characters, mixed text counts both scripts and budgets apply before draft saves', async t => {
  assert.equal(countWords('中文能力 TypeScript testing', 'zh-CN'), 6)
  assert.equal(countWords('中文能力 TypeScript testing', 'en'), 6)
  const f = await published(t), run = value(await f.api.resumes.getRun({ id: f.run.id })).run
  const body = { ...f.content, language: 'zh-CN' as const, summary: { ...f.content.summary, text: '中'.repeat(501) } }
  assert.throws(() => validateContent({ ...run, language: 'zh-CN' }, body), { code: 'CONFLICT' })
})
test('snapshot includes every saved fact atomically and live edits cannot mutate historical basics or evidence', async t => {
  const f = await seed(t)
  const second = value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: '中文 TypeScript' } }))
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }))
  assert.equal(run.inputSnapshot.facts.length, 2)
  value(await f.api.profiles.editFact({ id: second.id, details: { kind: 'SKILL', content: 'Changed live' } }))
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'Changed live' } }))
  const saved = value(await f.api.resumes.getRun({ id: run.id })).run
  assert.equal(saved.inputSnapshot.profile.name, 'PRIVATE_PERSON')
  assert.equal(saved.inputSnapshot.facts.find(fact => fact.id === second.id)?.content, '中文 TypeScript')
  assert.deepEqual(f.backend.dispatch('resumes', 'createRun', { jobId: f.job.id, profileId: f.profile.id, factIds: [second.id] }), { ok: false, error: 'INVALID_INPUT' })
})

test('reviewed semantic fixtures document that valid fact IDs cannot certify metrics or responsibility claims', async t => {
  const f = await published(t), run = value(await f.api.resumes.getRun({ id: f.run.id })).run
  const reviewed = JSON.parse(readFileSync(resolve('tests/fixtures/resume-evidence.json'), 'utf8')) as { cases: { fact: string; supported: string; unsupported: string; issues: string[] }[] }
  for (const example of reviewed.cases) {
    const snapshot = { ...run.inputSnapshot, facts: [{ ...f.fact, content: example.fact }] }
    const grounded = { ...f.content, summary: { ...f.content.summary, text: example.supported } }
    const unsupported = { ...grounded, summary: { ...grounded.summary, text: example.unsupported } }
    assert(example.issues.length > 0)
    assert.doesNotThrow(() => validateContent({ ...run, inputSnapshot: snapshot }, grounded))
    // This intentionally passes structural checks. The reviewed example must remain marked unsupported.
    assert.doesNotThrow(() => validateContent({ ...run, inputSnapshot: snapshot }, unsupported))
  }
})


test('a supplied introduction requires a summary in draft and polish while historical snapshots remain valid', async t => {
  const f = await published(t), run = value(await f.api.resumes.getRun({ id: f.run.id })).run
  const body = materializeDocument(run.inputSnapshot, 'en', { summary: null, experience: [], projects: [], education: [],
    skills: [{ id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] }] })
  const historical = structuredClone(run)
  delete (historical.inputSnapshot.profile as { introduction?: string }).introduction
  validateContent(historical, content(body))
  run.inputSnapshot.profile.introduction = f.fact.content
  assert.throws(() => validateContent(run, content(body)), { code: 'CONFLICT' })
  assert.throws(() => validateContent(run, content(body), true), { code: 'CONFLICT' })
  const preserved = { ...body, skills: [], summary: { id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] } }
  validateContent(run, content(preserved))
  run.draft = preserved
  validateContent(run, content(preserved), true)
  assert(!('introduction' in preserved.basics))
})
