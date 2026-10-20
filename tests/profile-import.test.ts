import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, value } from './helpers'
import type { ConfirmedImport } from '../src/domain/candidate/import.types'
import { parseImportDraft } from '../src/platform/profile-import/draft'
import { changeImportFact, changeImportItem, confirmedSelection, confirmImportItem, savedSelection } from '../src/pages/profile/import-state'
import { itemDetails, validateItemDates } from '../src/domain/candidate/candidate.validation'

export function resumeOutput() {
  const fact = (content: string) => ({ kind: 'ACHIEVEMENT', content, tags: [], source: { page: 1, quote: content } })
  return { contact: { name: 'Candidate', email: 'new@example.com', phone: '', location: '' }, links: [{ label: 'Portfolio', url: 'https://example.com' }],
    items: [{ type: 'EXPERIENCE', title: 'Engineer', startDateText: '2020-03', endDateText: '', isCurrent: true, facts: [fact('Built services'), fact('Improved latency')] }], facts: [fact('English')] }
}
export const sourcePages = [{ page: 1, text: 'Candidate\nBuilt services\nImproved latency\nEnglish' }]
const input = (): ConfirmedImport => ({ sessionId: randomUUID(), batchId: randomUUID(), profileId: null, contact: { name: 'Candidate' }, links: [],
  items: [{ draftId: randomUUID(), details: { type: 'EXPERIENCE', title: 'Engineer', metadata: { startDateText: '2020-03', isCurrent: true } } }], facts: [] })

test('one imported experience owns multiple confirmed facts with separate IDs and a shared transaction', async t => {
  const f = fixture(t), args = input()
  args.facts = ['Built services', 'Improved latency'].map(content => ({ draftId: randomUUID(), itemDraftId: args.items[0].draftId, profileItemId: null, details: { kind: 'ACHIEVEMENT', content, evidence: 'Page 1\nSource' } }))
  const saved = value(await f.api.profiles.applyConfirmedImport(args))
  assert.equal(saved.items.length, 1); assert.equal(saved.facts.length, 2)
  assert.notEqual(saved.facts[0].id, saved.facts[1].id)
  assert(saved.facts.every(fact => fact.profileItemId === saved.items[0].id && fact.verificationStatus === 'CONFIRMED'))
  assert.equal(saved.items[0].startDate, null); assert.equal(saved.items[0].metadata.startDateText, '2020-03')
  const logs = value(await f.api.audit.list({ limit: 100 })).items
  assert.equal(new Set(logs.map(log => log.transactionId)).size, 1)
  assert.equal(logs.filter(log => log.targetType === 'fact' && log.action === 'UPDATE').length, 2)
  assert(!JSON.stringify(logs).includes('Built services'))
})
test('contact import applies only confirmed fields, appends links and supports standalone facts', async t => {
  const f = fixture(t), profile = value(await f.api.profiles.createProfile({ name: 'Old name', email: 'keep@example.com', phone: '123' }))
  const args = input(); args.profileId = profile.id; args.contact = { name: 'Updated name' }; args.items = []
  args.links = [{ draftId: randomUUID(), label: 'Portfolio', url: 'https://example.com' }]
  args.facts = [{ draftId: randomUUID(), itemDraftId: null, profileItemId: null, details: { kind: 'LANGUAGE', content: 'English' } }]
  const saved = value(await f.api.profiles.applyConfirmedImport(args))
  assert.equal(saved.profile.email, 'keep@example.com'); assert.equal(saved.profile.phone, '123'); assert.equal(saved.profile.name, 'Updated name')
  assert.equal(saved.profile.links.length, 1); assert.equal(saved.facts[0].profileItemId, null)
})
test('late relationship failure rolls back profile, items, facts and success audits', async t => {
  const f = fixture(t), args = input()
  args.facts = [args.items[0].draftId, randomUUID()].map(itemDraftId => ({ draftId: randomUUID(), itemDraftId, profileItemId: null, details: { kind: 'SKILL', content: 'SQL' } }))
  assert.deepEqual(await f.api.profiles.applyConfirmedImport(args), { ok: false, error: 'CONFLICT' })
  assert.equal(value(await f.api.profiles.listProfiles({})).total, 0)
  const logs = value(await f.api.audit.list({})).items
  assert.equal(logs.length, 1); assert.equal(logs[0].status, 'FAILURE')
})
test('import rejects missing name, duplicate draft IDs, invalid dates and cross-profile parents', async t => {
  const f = fixture(t), args = input(); args.contact = {}
  assert.equal((await f.api.profiles.applyConfirmedImport(args)).ok, false)
  args.contact = { name: 'Candidate' }; args.items.push(args.items[0])
  assert.equal((await f.api.profiles.applyConfirmedImport(args)).ok, false)
  args.items.pop(); args.items[0].details.metadata = { startDateText: '2020-13' }
  assert.equal((await f.api.profiles.applyConfirmedImport(args)).ok, false)
  const other = value(await f.api.profiles.createProfile({ name: 'Other' }))
  const item = value(await f.api.profiles.addItem({ profileId: other.id, details: { type: 'PROJECT', title: 'Other project' } }))
  args.items = []; args.facts = [{ draftId: randomUUID(), itemDraftId: null, profileItemId: item.id, details: { kind: 'SKILL', content: 'SQL' } }]
  assert.deepEqual(await f.api.profiles.applyConfirmedImport(args), { ok: false, error: 'CONFLICT' })
})
test('AI draft preserves grouped facts, source excerpts and date precision; bad fields block only their entries', () => {
  const raw = resumeOutput(); raw.items[0].startDateText = '2020-13'
  raw.items[0].facts[1].source.quote = 'Invented source'
  const draft = parseImportDraft(JSON.stringify(raw), sourcePages)
  assert.equal(draft.items.length, 1); assert.equal(draft.facts.length, 3)
  assert.equal(draft.items[0].error, true); assert.equal(draft.facts[0].error, false); assert.equal(draft.facts[1].error, true)
  assert.equal(draft.facts[0].itemDraftId, draft.items[0].draftId); assert.equal(draft.facts[2].itemDraftId, null)
  assert.equal(draft.facts[0].details.evidence, 'Page 1\nBuilt services')
  const edited = changeImportFact(draft, draft.facts[1].draftId, { details: { ...draft.facts[1].details, tags: ['reviewed'] } })
  assert.equal(edited.facts[1].error, true, 'unrelated edits cannot clear an invalid source excerpt')
  const corrected = changeImportFact(edited, draft.facts[1].draftId, { details: { ...edited.facts[1].details, evidence: 'Page 1\nImproved latency' } })
  assert.equal(corrected.facts[1].error, false)
  assert.throws(() => parseImportDraft('not JSON', sourcePages), /IMPORT_INVALID_OUTPUT/)
})
test('confirmation is per fact, edits invalidate the correct confirmations and partial saves preserve parents', async t => {
  const f = fixture(t); let draft = parseImportDraft(JSON.stringify(resumeOutput()), sourcePages)
  const parentId = draft.items[0].draftId, sessionId = randomUUID()
  draft.facts[0].confirmed = true
  assert.equal(confirmedSelection(draft, sessionId, randomUUID(), null).facts.length, 0)
  draft = confirmImportItem(draft, parentId, true)
  assert.equal(draft.facts[1].confirmed, false)
  draft.contact.name.confirmed = true
  const subset = confirmedSelection(draft, sessionId, randomUUID(), null), saved = value(await f.api.profiles.applyConfirmedImport(subset))
  draft = savedSelection(draft, subset, saved)
  assert.equal(draft.items[0].savedId, saved.items[0].id); assert.equal(draft.facts.length, 2)
  assert.equal(draft.facts[0].itemDraftId, parentId)
  draft.facts.forEach(fact => { fact.confirmed = true })
  draft = changeImportFact(draft, draft.facts[0].draftId, { details: { ...draft.facts[0].details, content: 'Edited' } })
  assert.equal(draft.facts[0].confirmed, false); assert.equal(draft.facts[1].confirmed, true)
  const fresh = parseImportDraft(JSON.stringify(resumeOutput()), sourcePages)
  fresh.items[0].confirmed = true; fresh.facts[0].confirmed = true
  const edited = changeImportItem(fresh, fresh.items[0].draftId, { ...fresh.items[0].details, title: 'Changed' })
  assert.equal(edited.items[0].confirmed, false); assert.equal(edited.facts[0].confirmed, false)
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
