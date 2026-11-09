import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fork } from 'node:child_process'
import { fixture, seed, published } from './helpers'
import { createResumeOutput } from '../src/platform/resume-output/service'

function directory(t: import('node:test').TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'resume-leases-'))
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return { root, resources: { after: (fn: () => void | Promise<void>) => { cleanups.push(fn) } } }
}
test('a second backend preserves live generation; only a dead owner is recovered and fenced', async t => {
  const { root, resources } = directory(t), path = join(root, 'database.sqlite'), a = await seed(resources, path)
  const run = a.backend.resumes.createRun({ jobId: a.job.id, profileId: a.profile.id }, { start: true })
  const input = { runId: run.id, bulletId: run.assembled!.experience[0].bullets[0].id, text: 'Supported', requestId: randomUUID() }
  const b = fixture(resources, path)
  assert.equal(b.backend.resumes.getRun({ id: run.id }).run.state, 'REWRITING')

  assert.throws(() => b.backend.resumes.cancelRun({ id: run.id }), { code: 'FORBIDDEN' })
  assert.throws(() => b.backend.generation.rewriteBullet(input), { code: 'FORBIDDEN' })
  a.database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(a.backend.lease.id)
  b.backend.recover()
  assert.equal(b.backend.resumes.getRun({ id: run.id }).run.state, 'INTERRUPTED')

  assert.throws(() => a.backend.generation.rewriteBullet(input))
})

test('a separate process write lock cannot partially commit a generation stage; explicit retry succeeds after release', async t => {
  const { root, resources } = directory(t), path = join(root, 'database.sqlite'), f = await seed(resources, path)
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id }, { start: true })
  const child = fork(join('tests', 'fixtures', 'database-lock.cjs'), [path], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  resources.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await exited
    }
  })
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('Lock fixture exited')) }) })
  const input = { runId: run.id, bulletId: run.assembled!.experience[0].bullets[0].id, text: 'Supported', requestId: randomUUID() }
  assert.throws(() => f.backend.generation.rewriteBullet(input), { code: 'STORAGE_BUSY' })
  assert.deepEqual(f.backend.rewrittenBulletIds(run.id), [])
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.send({ release: true }); await exited
  assert.equal(f.backend.generation.rewriteBullet(input).changed, true)
})
test('concurrent output has one owner and a late expired worker cannot replace recovered state or write files', async t => {
  const { root, resources } = directory(t), a = await published(resources, join(root, 'database.sqlite')), b = fixture(resources, join(root, 'database.sqlite'))
  let finish!: (result: { html: string; pdf: Buffer; pages: number }) => void
  const output = createResumeOutput(a.backend, join(root, 'artifacts'), '', () => new Promise(resolve => { finish = resolve }))
  const pending = output.build(a.artifact.id, new AbortController().signal)
  assert.throws(() => a.backend.resumes.editArtifact({ id: a.artifact.id, title: a.artifact.title, expectedRevision: 1, content: a.artifact.content }), { code: 'CONFLICT' })
  const other = createResumeOutput(b.backend, join(root, 'artifacts'), '', async () => ({ html: 'other', pdf: Buffer.from('PDF'), pages: 1 }))
  await assert.rejects(other.build(a.artifact.id, new AbortController().signal), { code: 'CONFLICT' })
  assert.equal(b.backend.resumes.getArtifact({ id: a.artifact.id }).artifact.output.status, 'RUNNING')
  a.database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(a.backend.lease.id)
  b.backend.recover()
  finish({ html: 'late', pdf: Buffer.from('PDF'), pages: 1 }); await pending
  assert.equal(b.backend.resumes.getArtifact({ id: a.artifact.id }).artifact.output.error, 'OUTPUT_INTERRUPTED')
  assert.equal(existsSync(join(root, 'artifacts', a.artifact.id)), false)
  assert.equal((await other.build(a.artifact.id, new AbortController().signal)).output.status, 'READY')
})
