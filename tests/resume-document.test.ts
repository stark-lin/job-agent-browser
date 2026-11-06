import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { seed, published, value } from './helpers'
import { assembleResume, countWords, documentProvenance, statements } from '../src/domain/resume/document'
import { validateGeneratedResume } from '../src/domain/resume/resume.validation'
import type { ResumeOptimization } from '../src/domain/resume/resume.types'

test('assembly copies basics and item metadata and uses source order for entries and bullets', async t => {
  const f = await seed(t)
  const second = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'EXPERIENCE', title: 'Second' } }))
  const fact = value(await f.api.profiles.addFact({ profileId: f.profile.id, profileItemId: f.item.id, details: { kind: 'ACHIEVEMENT', content: 'Second bullet' } }))
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  const optimization: ResumeOptimization = { language: 'en', summary: null, skills: [], entries: [
    { profileItemId: second.id, bullets: [] },
    { profileItemId: f.item.id, bullets: [fact, f.fact].map(source => ({ text: source.content, factIds: [source.id] })) }
  ] }
  const body = assembleResume(run.inputSnapshot, optimization, randomUUID)
  validateGeneratedResume(run, body)
  assert.equal(body.basics.name, f.profile.name)
  assert.deepEqual(body.experience.map(entry => entry.title), [f.item.title, second.title])
  assert.deepEqual(body.experience[0].bullets.map(bullet => bullet.text), [f.fact.content, fact.content])
  assert.deepEqual(documentProvenance(body), statements(body).map(block => ({ blockId: block.id, factIds: block.factIds })))
})

test('optimization rejects empty, foreign, duplicate and wrong-item sources', async t => {
  const f = await seed(t)
  const other = value(await f.api.profiles.addItem({ profileId: f.profile.id, details: { type: 'PROJECT', title: 'Other' } }))
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  const optimization: ResumeOptimization = { language: 'en', summary: null, skills: [], entries: [] }
  for (const factIds of [[], [randomUUID()], [f.fact.id, f.fact.id]]) assert.throws(() => assembleResume(run.inputSnapshot, {
    ...optimization, summary: { text: 'Supported', factIds }
  }, randomUUID), { code: 'CONFLICT' })
  for (const entries of [
    [{ profileItemId: other.id, bullets: [{ text: 'Wrong owner', factIds: [f.fact.id] }] }],
    [{ profileItemId: f.item.id, bullets: ['One', 'Two'].map(text => ({ text, factIds: [f.fact.id] })) }]
  ]) assert.throws(() => assembleResume(run.inputSnapshot, { ...optimization, entries }, randomUUID), { code: 'CONFLICT' })
  assert.throws(() => assembleResume(run.inputSnapshot, { ...optimization, skills: [{ text: 'Not a skill', factIds: [f.fact.id] }] }, randomUUID), { code: 'CONFLICT' })
})

test('Chinese budget counts characters, mixed text counts both scripts and budgets apply before saves', async t => {
  assert.equal(countWords('中文能力 TypeScript testing', 'zh-CN'), 6)
  assert.equal(countWords('中文能力 TypeScript testing', 'en'), 6)
  const f = await published(t)
  const body = { ...f.content, language: 'zh-CN' as const, summary: { ...f.content.summary, text: '中'.repeat(501) } }
  assert.throws(() => validateGeneratedResume(f.run, body), { code: 'CONFLICT' })
})

test('snapshot includes every saved fact atomically and live edits cannot mutate historical basics or evidence', async t => {
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

test('valid Fact IDs alone cannot certify the semantic claims in reviewed fixtures', async t => {
  const f = await published(t)
  const reviewed = JSON.parse(readFileSync(resolve('tests/fixtures/resume-evidence.json'), 'utf8')) as { cases: { fact: string; supported: string; unsupported: string; issues: string[] }[] }
  for (const example of reviewed.cases) {
    const snapshot = { ...f.run.inputSnapshot, facts: [{ ...f.fact, content: example.fact }] }
    for (const text of [example.supported, example.unsupported]) {
      assert(example.issues.length > 0)
      const body = assembleResume(snapshot, { language: 'en', summary: { text, factIds: [f.fact.id] }, entries: [], skills: [] }, randomUUID)
      validateGeneratedResume(f.run, body)
    }
  }
})

test('a supplied introduction requires a summary in the generated document', async t => {
  const f = await published(t)
  f.run.inputSnapshot.profile.introduction = f.fact.content
  assert.throws(() => validateGeneratedResume(f.run, { ...f.content, summary: null, experience: [
    { ...assembleResume(f.run.inputSnapshot, { language: 'en', summary: null, skills: [], entries: [{ profileItemId: f.item.id,
      bullets: [{ text: f.fact.content, factIds: [f.fact.id] }] }] }, randomUUID).experience[0] }
  ] }), { code: 'CONFLICT' })
  validateGeneratedResume(f.run, f.content)
})
