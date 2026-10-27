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
test('a second backend preserves live generation and audit; only a dead owner is recovered and fenced', async t => {
  const { root, resources } = directory(t), path = join(root, 'database.sqlite'), a = await seed(resources, path)
  const run = a.backend.resumes.createRun({ jobId: a.job.id, profileId: a.profile.id })
  a.backend.generation.start({ id: run.id })
  const invocationId = randomUUID()
  a.backend.toolAudit.sink.start({ invocationId, agentId: 'resume', runId: run.id, tool: a.backend.toolCapabilities.read[0].descriptor })
  const b = fixture(resources, path)
  assert.equal(b.backend.resumes.getRun({ id: run.id }).run.status, 'RUNNING')
  assert.equal(b.backend.toolAudit.list().filter(row => row.invocation_id === invocationId).length, 1)
  assert.throws(() => b.backend.resumes.cancelRun({ id: run.id }), { code: 'FORBIDDEN' })
  assert.throws(() => b.backend.generation.recordScores({ id: run.id, language: 'en', scores: [{ factId: a.fact.id, score: 90, reason: '' }] }), { code: 'FORBIDDEN' })
  a.database.connection.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(a.backend.lease.id)
  b.backend.recover()
  assert.equal(b.backend.resumes.getRun({ id: run.id }).run.status, 'INTERRUPTED')
  assert.equal(b.backend.toolAudit.list().find(row => row.invocation_id === invocationId && row.phase === 'END')?.status, 'INTERRUPTED')
  assert.throws(() => a.backend.generation.recordScores({ id: run.id, language: 'en', scores: [{ factId: a.fact.id, score: 90, reason: '' }] }))
})

test('a separate process write lock cannot partially commit a generation stage; explicit retry succeeds after release', async t => {
  const { root, resources } = directory(t), path = join(root, 'database.sqlite'), f = await seed(resources, path)
  const run = f.backend.resumes.createRun({ jobId: f.job.id, profileId: f.profile.id })
  f.backend.generation.start({ id: run.id })
  const child = fork(join('tests', 'fixtures', 'database-lock.cjs'), [path], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  resources.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await exited
    }
  })
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('Lock fixture exited')) }) })
  const scores = { id: run.id, language: 'en', scores: [{ factId: f.fact.id, score: 90, reason: '' }] }
  assert.throws(() => f.backend.generation.recordScores(scores), { code: 'AUDIT_UNAVAILABLE' })
  assert.equal(f.backend.resumes.getRun({ id: run.id }).run.scores, null)
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.send({ release: true }); await exited
  assert.equal(f.backend.generation.recordScores(scores).stage, 'gate')
})
test('concurrent output has one owner and a late expired worker cannot replace recovered state or write files', async t => {
  const { root, resources } = directory(t), a = await published(resources, join(root, 'database.sqlite')), b = fixture(resources, join(root, 'database.sqlite'))
  let finish!: (result: { html: string; pdf: Buffer; pages: number }) => void
  const output = createResumeOutput(a.backend, join(root, 'artifacts'), '', () => new Promise(resolve => { finish = resolve }))
  const pending = output.build(a.artifact.id, new AbortController().signal)
  assert.throws(() => a.backend.resumes.editArtifact({ id: a.artifact.id, title: a.artifact.title, content: a.artifact.content }), { code: 'CONFLICT' })
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
