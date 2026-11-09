import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrate, migrations } from '../src/platform/database/migrations'
import { published } from './helpers'

test('V22 upgrade preserves all rows/checksums, initializes independent titles, leaves drafts', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
  try {
    migrate(db, migrations.slice(0, 22))
    for (const name of ['Person', '']) db.prepare("INSERT INTO profiles(id,name,email,phone,location,links_json,updated_at) VALUES(?,?,'','','','[]','2026-01-01')").run(randomUUID(), name)
    const rows = db.prepare('SELECT * FROM profiles ORDER BY id').all(), checksums = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
    migrate(db)
    assert.deepEqual(db.prepare('SELECT * FROM profiles ORDER BY id').all().map(row => ({ ...row })), rows.map(row => ({ ...row, title: row.name || 'Profile' })))
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=22 ORDER BY version').all(), checksums)
    assert.equal(db.prepare('SELECT count(*) n FROM profile_baselines').get()?.n, 0)
    assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()?.n, 23)
  } finally { db.close() }
})

test('freeze, duplicate working copy and restore preserve complete relationships without changing history', async t => {
  const f = await published(t), p = f.backend.profiles, db = f.database.connection
  const parent = p.addItem({ profileId: f.profile.id, details: { type: 'PROJECT', title: 'Parent', sortOrder: 7, metadata: { technologies: ['SQL'] } } })
  const child = p.addItem({ profileId: f.profile.id, parentItemId: parent.id, details: { type: 'PROJECT', title: 'Child', sortOrder: 2 } })
  p.addFact({ profileId: f.profile.id, profileItemId: child.id, details: { kind: 'OTHER', content: 'Nested', tags: ['tag'] } })
  const { id, revision: _revision, updatedAt: _updated, ...details } = p.getProfile({ id: f.profile.id })
  p.editContact({ id, details: { ...details, title: 'Backend CV', introduction: 'Reviewed introduction', links: [{ label: 'Site', url: 'https://example.com' }] } })
  const approved = p.getProfile({ id }), revision = approved.revision
  assert.equal(p.getBaselineStatus({ profileId: id }).status, 'DRAFT')
  assert.throws(() => p.freezeBaseline({ profileId: id, expectedRevision: revision - 1 }), { code: 'CONFLICT' })
  assert.equal(p.freezeBaseline({ profileId: id, expectedRevision: revision }).status, 'READY')
  assert.deepEqual(p.getProfile({ id }), approved)
  const baseline = db.prepare('SELECT * FROM profile_baselines WHERE profile_id=?').get(id)!
  const snapshot = JSON.parse(String(baseline.snapshot_json))
  assert.throws(() => db.prepare('UPDATE profile_baselines SET snapshot_json=? WHERE profile_id=?').run('{}', id), /immutable profile baseline/)
  assert.throws(() => p.freezeBaseline({ profileId: id, expectedRevision: revision }), { code: 'CONFLICT' })
  const fullCopy = p.duplicateProfile({ profileId: id, expectedRevision: revision, title: 'Full working copy' })
  const copiedItems = p.listItems({ profileId: fullCopy.id }).items, copiedParent = copiedItems.find(i => i.title === 'Parent')!, copiedChild = copiedItems.find(i => i.title === 'Child')!
  assert.notEqual(copiedChild.id, child.id); assert.equal(copiedChild.parentItemId, copiedParent.id)
  assert.equal(p.listFacts({ profileId: fullCopy.id }).items.find(f => f.content === 'Nested')?.profileItemId, copiedChild.id)
  assert.equal(p.getBaselineStatus({ profileId: fullCopy.id }).status, 'DRAFT')
  const artifact = f.backend.resumes.getArtifact({ id: f.artifact.id })
  const run = f.backend.resumes.getRun({ id: f.run.id })
  const other = p.createProfile({ name: 'Other' })
  p.editContact({ id, details: { ...details, title: 'Working edit', name: 'Edited' } })
  p.deleteItem({ id: parent.id })
  const current = p.getProfile({ id })
  const copy = p.duplicateProfile({ profileId: id, expectedRevision: current.revision, title: 'Copied working' })
  assert.equal(copy.name, 'Edited'); assert.equal(copy.title, 'Copied working')
  assert.equal(p.getBaselineStatus({ profileId: copy.id }).status, 'DRAFT')
  assert.equal(p.listItems({ profileId: copy.id }).total, p.listItems({ profileId: id }).total)
  assert.notEqual(p.listItems({ profileId: copy.id }).items[0].id, f.item.id)
  assert.notEqual(p.listFacts({ profileId: copy.id }).items[0].id, f.fact.id)
  assert.throws(() => p.restoreBaseline({ profileId: id, expectedRevision: revision }), { code: 'CONFLICT' })
  const beforeRestore = ['profiles', 'profile_items', 'facts', 'profile_order_counters'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  db.exec("CREATE TRIGGER fixture_restore_failure BEFORE INSERT ON profile_items BEGIN SELECT RAISE(ABORT,'fixture'); END")
  assert.throws(() => p.restoreBaseline({ profileId: id, expectedRevision: current.revision }), { code: 'CONFLICT' })
  for (const [index, table] of ['profiles', 'profile_items', 'facts', 'profile_order_counters'].entries()) assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), beforeRestore[index])
  db.exec('DROP TRIGGER fixture_restore_failure')
  const restored = p.restoreBaseline({ profileId: id, expectedRevision: current.revision })
  assert.equal(restored.title, approved.title); assert.equal(restored.name, approved.name)
  assert.equal(restored.introduction, approved.introduction); assert.deepEqual(restored.links, approved.links)
  assert(restored.revision > current.revision + 1)
  const items = p.listItems({ profileId: id }).items
  assert.deepEqual(items.map(i => i.title), snapshot.items.map((i: { title: string }) => i.title))
  const newChild = items.find(i => i.title === 'Child')!, newParent = items.find(i => i.title === 'Parent')!
  assert.equal(newChild.parentItemId, newParent.id); assert.notEqual(newChild.id, child.id)
  assert.equal(p.listFacts({ profileId: id }).items.find(f => f.content === 'Nested')?.profileItemId, newChild.id)
  assert.deepEqual(db.prepare('SELECT sort_order FROM facts WHERE profile_id=? ORDER BY sort_order,created_at,id').all(id).map(r => r.sort_order), snapshot.facts.map((f: { sortOrder: number }) => f.sortOrder))
  assert.deepEqual(p.getProfile({ id: other.id }), other)
  assert.deepEqual(f.backend.resumes.getRun({ id: f.run.id }).run, run.run)
  const afterArtifact = f.backend.resumes.getArtifact({ id: f.artifact.id })
  assert.deepEqual(afterArtifact.artifact, artifact.artifact)
  assert(JSON.stringify(afterArtifact).includes('MISSING'))
  assert.deepEqual(db.prepare('SELECT * FROM profile_baselines WHERE profile_id=?').get(id), baseline)
  const beforeOrder = Math.max(...items.map(i => i.sortOrder))
  assert(p.addItem({ profileId: id, details: { type: 'PROJECT', title: 'Next' } }).sortOrder > beforeOrder)
  p.deleteProfile({ id })
  assert.equal(db.prepare('SELECT * FROM profile_baselines WHERE profile_id=?').get(id), undefined)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('duplicate and restore retain equal-order ties with fresh UUIDs', async t => {
  const f = await published(t), p = f.backend.profiles, id = f.profile.id, db = f.database.connection
  for (let n = 0; n < 8; n++) {
    const item = p.addItem({ profileId: id, details: { type: 'PROJECT', title: `Tie ${n}`, sortOrder: 0 } })
    p.addFact({ profileId: id, profileItemId: item.id, details: { kind: 'OTHER', content: `Tie fact ${n}` } })
  }
  db.prepare("UPDATE facts SET sort_order=0,created_at='2026-01-01T00:00:00.000Z' WHERE profile_id=?").run(id)
  const items = p.listItems({ profileId: id }).items.map(i => i.title), facts = p.listFacts({ profileId: id }).items.map(f => f.content)
  const revision = p.getProfile({ id }).revision
  p.freezeBaseline({ profileId: id, expectedRevision: revision })
  const copy = p.duplicateProfile({ profileId: id, expectedRevision: revision, title: 'Tie copy' })
  assert.deepEqual(p.listItems({ profileId: copy.id }).items.map(i => i.title), items)
  assert.deepEqual(p.listFacts({ profileId: copy.id }).items.map(f => f.content), facts)
  p.restoreBaseline({ profileId: id, expectedRevision: revision })
  assert.deepEqual(p.listItems({ profileId: id }).items.map(i => i.title), items)
  assert.deepEqual(p.listFacts({ profileId: id }).items.map(f => f.content), facts)
})
