import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, value } from './helpers'
import type { ApplyImport } from '../src/domain/candidate/import.types'
import { importPrompt, parseImportDraft } from '../src/platform/profile-import/draft'
import { changeImportFact, changeImportItem, importSelection, importError, ignoreImportItem, savedSelection } from '../src/pages/profile/import-state'
import { itemDetails, validateItemDates } from '../src/domain/candidate/candidate.validation'

export function resumeOutput() {
  const fact = (content: string) => ({ kind: 'ACHIEVEMENT', content, tags: [] })
  return { contact: { name: 'Candidate', email: 'new@example.com', phone: '', location: '' }, links: [{ label: 'Portfolio', url: 'https://example.com' }],
    items: [{ type: 'EXPERIENCE', title: 'Engineer', startDateText: '2020-03', endDateText: '', isCurrent: true, facts: [fact('Built services'), fact('Improved latency')] }], facts: [fact('English')] }
}
export const sourcePages = [{ page: 1, text: 'Candidate\nBuilt services\nImproved latency\nEnglish' }]
const input = (): ApplyImport => ({ sessionId: randomUUID(), batchId: randomUUID(), profileId: null, contact: { name: 'Candidate' }, links: [],
  items: [{ draftId: randomUUID(), details: { type: 'EXPERIENCE', title: 'Engineer', metadata: { startDateText: '2020-03', isCurrent: true } } }], facts: [] })

test('one imported experience owns multiple saved facts with separate IDs and a shared transaction', async t => {
  const f = fixture(t), args = input()
  args.facts = ['Built services', 'Improved latency'].map(content => ({ draftId: randomUUID(), itemDraftId: args.items[0].draftId, profileItemId: null, details: { kind: 'ACHIEVEMENT', content, evidence: 'Page 1\nSource' } }))
  const saved = value(await f.api.profiles.applyImport(args))
  assert.equal(saved.items.length, 1); assert.equal(saved.facts.length, 2)
  assert.notEqual(saved.facts[0].id, saved.facts[1].id)
  assert(saved.facts.every(fact => fact.profileItemId === saved.items[0].id))
  assert.equal(saved.items[0].startDate, null); assert.equal(saved.items[0].metadata.startDateText, '2020-03')
  const logs = value(await f.api.audit.list({ limit: 100 })).items
  assert.equal(new Set(logs.map(log => log.transactionId)).size, 1)
  assert.equal(logs.filter(log => log.targetType === 'fact' && log.action === 'CREATE').length, 2)
  assert(!JSON.stringify(logs).includes('Built services'))
})
test('contact import applies only submitted fields, appends links and supports standalone facts', async t => {
  const f = fixture(t), profile = value(await f.api.profiles.createProfile({ name: 'Old name', email: 'keep@example.com', phone: '123' }))
  const args = input(); args.profileId = profile.id; args.contact = { name: 'Updated name' }; args.items = []
  args.links = [{ draftId: randomUUID(), label: 'Portfolio', url: 'https://example.com' }]
  args.facts = [{ draftId: randomUUID(), itemDraftId: null, profileItemId: null, details: { kind: 'LANGUAGE', content: 'English' } }]
  const saved = value(await f.api.profiles.applyImport(args))
  assert.equal(saved.profile.email, 'keep@example.com'); assert.equal(saved.profile.phone, '123'); assert.equal(saved.profile.name, 'Updated name')
  assert.equal(saved.profile.links.length, 1); assert.equal(saved.facts[0].profileItemId, null)
})
test('late relationship failure rolls back profile, items, facts and success audits', async t => {
  const f = fixture(t), args = input()
  args.facts = [args.items[0].draftId, randomUUID()].map(itemDraftId => ({ draftId: randomUUID(), itemDraftId, profileItemId: null, details: { kind: 'SKILL', content: 'SQL' } }))
  assert.deepEqual(await f.api.profiles.applyImport(args), { ok: false, error: 'CONFLICT' })
  assert.equal(value(await f.api.profiles.listProfiles({})).total, 0)
  const logs = value(await f.api.audit.list({})).items
  assert.equal(logs.length, 1); assert.equal(logs[0].status, 'FAILURE')
})
test('import rejects missing name, duplicate draft IDs, invalid dates and cross-profile parents', async t => {
  const f = fixture(t), args = input(); args.contact = {}
  assert.equal((await f.api.profiles.applyImport(args)).ok, false)
  args.contact = { name: 'Candidate' }; args.items.push(args.items[0])
  assert.equal((await f.api.profiles.applyImport(args)).ok, false)
  args.items.pop(); args.items[0].details.metadata = { startDateText: '2020-13' }
  assert.equal((await f.api.profiles.applyImport(args)).ok, false)
  const other = value(await f.api.profiles.createProfile({ name: 'Other' }))
  const item = value(await f.api.profiles.addItem({ profileId: other.id, details: { type: 'PROJECT', title: 'Other project' } }))
  args.items = []; args.facts = [{ draftId: randomUUID(), itemDraftId: null, profileItemId: item.id, details: { kind: 'SKILL', content: 'SQL' } }]
  assert.deepEqual(await f.api.profiles.applyImport(args), { ok: false, error: 'CONFLICT' })
})
test('AI draft keeps grouped facts and date precision without source excerpts or page validation', () => {
  const raw = resumeOutput(); raw.items[0].startDateText = '2020-13'
  const draft = parseImportDraft(JSON.stringify(raw))
  assert.equal(draft.items.length, 1); assert.equal(draft.facts.length, 3)
  assert.equal(draft.items[0].error, true); assert(draft.facts.every(fact => !fact.error))
  assert.equal(draft.facts[0].itemDraftId, draft.items[0].draftId); assert.equal(draft.facts[2].itemDraftId, null)
  assert(draft.facts.every(fact => !('evidence' in fact.details) && !('sourceError' in fact)))
  const edited = changeImportFact(draft, draft.facts[1].draftId, { details: { ...draft.facts[1].details, tags: ['reviewed'] } })
  assert.equal(edited.facts[1].error, false)
  assert.throws(() => parseImportDraft('not JSON'), /IMPORT_INVALID_OUTPUT/)
  const old = structuredClone(raw) as unknown as { items: { facts: Record<string, unknown>[] }[] }
  old.items[0].facts[0].source = { page: 1, quote: 'Repeated fact text' }
  assert.throws(() => parseImportDraft(JSON.stringify(old)), /IMPORT_INVALID_OUTPUT/)
  const prompt = importPrompt(sourcePages)
  assert(!prompt.includes('"source"')); assert(!prompt.includes('"quote"')); assert(!prompt.includes('"page"'))
  assert(prompt.includes('Built services'))
})
test('valid entries save without confirmation; invalid entries block and ignored parents exclude children', async t => {
  const f = fixture(t); let draft = parseImportDraft(JSON.stringify(resumeOutput()))
  const sessionId = randomUUID(), parentId = draft.items[0].draftId
  draft.facts[1].ignored = true
  const subset = importSelection(draft, sessionId, randomUUID(), null)
  assert.equal(subset.facts.length, 2)
  const saved = value(await f.api.profiles.applyImport(subset))
  draft = savedSelection(draft, subset, saved)
  assert.equal(draft.items[0].savedId, saved.items[0].id)
  assert.equal(draft.facts.length, 1); assert.equal(draft.facts[0].itemDraftId, parentId)
  const fresh = parseImportDraft(JSON.stringify(resumeOutput()))
  let edited = changeImportItem(fresh, fresh.items[0].draftId, { ...fresh.items[0].details, title: '' })
  assert.equal(importError(edited), fresh.items[0].draftId)
  assert.throws(() => importSelection(edited, sessionId, randomUUID(), saved.profile.id))
  edited = ignoreImportItem(edited, fresh.items[0].draftId, true)
  assert.equal(importError(edited), null)
  assert.equal(importSelection(edited, sessionId, randomUUID(), saved.profile.id).facts.length, 1)
  const bad = changeImportFact(fresh, fresh.facts[0].draftId, { details: { kind: 'SKILL', content: '' } })
  assert.equal(importError(bad), fresh.facts[0].draftId)
})
test('partial dates and legacy day columns share range validation without inventing precision', () => {
  const parse = (details: object) => itemDetails({ type: 'EXPERIENCE', title: 'Engineer', ...details })
  assert.throws(() => validateItemDates(parse({ endDate: '2020-05-01', metadata: { startDateText: '2022' } })), /INVALID_INPUT/)
  assert.throws(() => validateItemDates(parse({ startDate: '2022-05-01', metadata: { endDateText: '2021-12' } })), /INVALID_INPUT/)
  assert.throws(() => validateItemDates(parse({ endDate: '2020-05-01', metadata: { isCurrent: true } })), /INVALID_INPUT/)
  const legacy = parse({ startDate: '2020-05-01', endDate: '2022-08-20', metadata: {} })
  validateItemDates(legacy); assert.equal(legacy.startDate, '2020-05-01'); assert.equal(legacy.metadata.startDateText, '')
  const partial = parse({ metadata: { startDateText: '2020', endDateText: '2020-02' } })
  validateItemDates(partial); assert.equal(partial.startDate, null); assert.equal(partial.metadata.startDateText, '2020')
})
