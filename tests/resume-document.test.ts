import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { seed, published, value } from './helpers'
import { createResumeFromProfile, countWords, documentProvenance, statements } from '../src/domain/resume/document'
import { validateGeneratedResume } from '../src/domain/resume/resume.validation'

test('profile copy preserves basics, section order, Item summaries and Fact provenance', async t => {
  const f = await seed(t)
  const second = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'EXPERIENCE', title: 'Second', summary: 'Saved summary' } }))
  const fact = value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'ACHIEVEMENT', content: 'Second bullet' } }))
  const skill = value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: 'TypeScript' } }))
  value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'OTHER', content: 'Stays in snapshot' } }))
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  const snapshot = structuredClone(run.inputSnapshot)
  snapshot.items[0].summary = f.fact.content
  snapshot.profile.introduction = 'Saved introduction'
  const body = createResumeFromProfile(snapshot, randomUUID)
  validateGeneratedResume({ ...run, inputSnapshot: snapshot }, body)
  assert.equal(body.basics.name, f.profile.name)
  assert.equal(body.summary?.text, 'Saved introduction')
  assert.deepEqual(body.summary?.factIds, [])
  assert.deepEqual(body.experience.map(entry => entry.title), [f.item.title, second.title])
  assert.deepEqual(body.experience[0].bullets.map(bullet => bullet.text), [f.fact.content, fact.content])
  assert.deepEqual(body.experience[1].bullets.map(bullet => ({ text: bullet.text, factIds: bullet.factIds })), [{ text: 'Saved summary', factIds: [] }])
  assert.deepEqual(body.skills[0].factIds, [skill.id])
  assert.deepEqual(documentProvenance(body), statements(body).map(block => ({ blockId: block.id, factIds: block.factIds })))
})

test('Chinese word targets are advisory and the saved introduction is required', async t => {
  assert.equal(countWords('中文能力 TypeScript testing', 'zh-CN'), 6)
  const f = await published(t)
  const snapshot = structuredClone(f.run.inputSnapshot)
  snapshot.profile.introduction = '中'.repeat(501)
  const body = createResumeFromProfile(snapshot, randomUUID)
  assert.equal(body.language, 'zh-CN')
  validateGeneratedResume({ ...f.run, inputSnapshot: snapshot }, body)
  assert.throws(() => validateGeneratedResume({ ...f.run, inputSnapshot: snapshot }, { ...body, summary: null }), { code: 'CONFLICT' })
})

test('snapshot includes every saved fact and live edits cannot mutate historical basics or evidence', async t => {
  const f = await seed(t)
  const second = value(await f.api.profiles.addFact({ profileId: f.profile.id, details: { kind: 'SKILL', content: '中文 TypeScript' } }))
  const run = value(await f.api.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }))
  assert.equal(run.inputSnapshot.facts.length, 2)
  value(await f.api.profiles.editFact({ id: second.id, details: { kind: 'SKILL', content: 'Changed live' } }))
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: 'Changed live' } }))
  const saved = value(await f.api.resumes.getRun({ id: run.id })).run
  assert.equal(saved.inputSnapshot.profile.name, f.profile.name)
  assert.equal(saved.inputSnapshot.facts.find(fact => fact.id === second.id)?.content, '中文 TypeScript')
})

test('reviewed evidence examples distinguish semantic accuracy from structural validation', async t => {
  const f = await published(t)
  const reviewed = JSON.parse(readFileSync(resolve('tests/fixtures/resume-evidence.json'), 'utf8')) as { cases: { fact: string; supported: string; unsupported: string; issues: string[] }[] }
  for (const example of reviewed.cases) {
    const snapshot = { ...f.run.inputSnapshot, facts: [{ ...f.fact, content: example.fact }] }
    const body = createResumeFromProfile(snapshot, randomUUID)
    assert(example.issues.length > 0)
    for (const text of [example.supported, example.unsupported]) {
      body.experience[0].bullets[0].text = text
      validateGeneratedResume(f.run, body)
      assert.deepEqual(body.experience[0].bullets[0].factIds, [f.fact.id])
    }
  }
})
