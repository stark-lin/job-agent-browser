import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture, value } from './helpers'
import { parseImportDraft } from '../src/platform/profile-import/draft'
import { profileParts, mergeProfileParts } from '../src/platform/profile-import/parts'
import { importSelection, importError } from '../src/pages/profile/import-state'

const introduction = '专注可靠服务的工程师。\n希望继续深入基础设施。'
test('profile introduction validates, preserves omitted updates and supports explicit clearing', async t => {
  const f = fixture(t), profile = value(await f.api.profiles.createProfile({ name: 'Candidate', introduction }))
  assert.equal(value(await f.api.profiles.getProfile({ id: profile.id })).introduction, introduction)
  assert.equal(value(await f.api.profiles.editContact({ id: profile.id, details: { name: 'Renamed' } })).introduction, introduction)
  for (const invalid of ['x'.repeat(2001), 'bad\0text']) {
    assert.deepEqual(await f.api.profiles.editContact({ id: profile.id, details: { name: 'Candidate', introduction: invalid } }), { ok: false, error: 'INVALID_INPUT' })
    assert.equal(value(await f.api.profiles.getProfile({ id: profile.id })).introduction, introduction)
  }
  assert.equal(value(await f.api.profiles.editContact({ id: profile.id, details: { name: 'Candidate', introduction: '' } })).introduction, '')
  assert.equal(value(await f.api.profiles.createProfile({ name: 'Old client' })).introduction, '')
  assert.equal(value(await f.api.profiles.createProfile({ name: 'Limit', introduction: '字'.repeat(2000) })).introduction.length, 2000)
  assert(!JSON.stringify(value(await f.api.audit.list({ limit: 100 }))).includes(introduction))
})

test('import review preserves original introduction, ignores missing text and allows explicit replacement or clearing', async t => {
  const f = fixture(t), profile = value(await f.api.profiles.createProfile({ name: 'Candidate', introduction }))
  const parse = (contact: object) => parseImportDraft(JSON.stringify({ contact, links: [], items: [], facts: [] }))
  for (const contact of [{ name: 'Imported' }, { introduction: '' }]) {
    const draft = parse(contact)
    assert.equal(draft.contact.introduction.ignored, true)
    const saved = value(await f.api.profiles.applyImport(importSelection(draft, randomUUID(), randomUUID(), profile.id)))
    assert.equal(saved.profile.introduction, introduction)
  }
  const draft = parse({ introduction: 'Original wording.\nSecond sentence.' })
  assert.equal(draft.contact.introduction.value, 'Original wording.\nSecond sentence.')
  assert.equal(draft.contact.introduction.ignored, false)
  draft.contact.introduction.value = 'x'.repeat(2001)
  assert.equal(importError(draft), 'contact-introduction')
  draft.contact.introduction.value = 'Reviewed wording.'
  assert.equal(value(await f.api.profiles.applyImport(importSelection(draft, randomUUID(), randomUUID(), profile.id))).profile.introduction, 'Reviewed wording.')
  draft.contact.introduction.value = ''
  assert.equal(value(await f.api.profiles.applyImport(importSelection(draft, randomUUID(), randomUUID(), profile.id))).profile.introduction, '')
})

test('parallel profile extraction keeps the contact-group introduction verbatim through merging', () => {
  const parts = profileParts([{ page: 1, text: introduction }], 'parallel')
  const raw = parts.map(part => part.parse(JSON.stringify(part.id === 'contact' ? { contact: { introduction }, links: [], facts: [] } : { items: [] })))
  assert.equal(mergeProfileParts(raw).contact.introduction.value, introduction)
})
