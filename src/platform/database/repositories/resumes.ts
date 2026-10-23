import type { ResumeRepository } from '../../../domain/resume/resume.repository'
import type { Artifact, ArtifactFact, GenerationRun } from '../../../domain/resume/resume.types'
import type { Store } from './store'
import type { RuntimeLease } from '../runtime-leases'
import { fail } from '../../../domain/common/errors'

export function resumeRepository(store: Store, lease: RuntimeLease): ResumeRepository {
  return {
    getRun: (id) => store.get('generation_run', id), runs: (id, limit, offset) => store.list('generation_runs', id ? 'job_id=?' : '1=1', id ? [id] : [], 'created_at DESC, id', limit, offset),
    insertRun(run) { store.insert('generation_run', run); lease.claim('generation', run.id) },
    requestRun(requestId, input) {
      const row = store.db.prepare('SELECT * FROM resume_start_receipts WHERE request_id=?').get(requestId)
      if (!row) return null
      if (row.runtime_id !== lease.id || row.input_json !== input) fail('CONFLICT')
      return store.get('generation_run', String(row.run_id))
    },
    recordRequest(requestId, input, runId) { store.db.prepare('INSERT INTO resume_start_receipts VALUES(?,?,?,?)').run(requestId, lease.id, runId, input) },
    saveRun(run) { lease.assert('generation', run.id); store.save('generation_run', run) },
    removeRun(id) {
      const run = store.get<GenerationRun>('generation_run', id)
      if (['PENDING', 'RUNNING'].includes(run.status) && lease.foreign('generation', id)) fail('FORBIDDEN')
      const artifact = store.db.prepare('SELECT id FROM artifacts WHERE generation_run_id=?').get(id)
      if (artifact) lease.available('output', String(artifact.id))
      store.remove('generation_run', id)
    },
    running: () => store.db.prepare("SELECT * FROM generation_runs WHERE status IN ('PENDING','RUNNING')").all()
      .map(row => store.decode<GenerationRun>(row)).filter(run => !lease.active('generation', run.id))
      .map(run => { lease.claim('generation', run.id); return run }),
    getArtifact: (id) => store.get('artifact', id),
    assertArtifactEditable(id) { lease.available('output', id) },
    artifactForRun(id) { const row = store.db.prepare('SELECT * FROM artifacts WHERE generation_run_id=?').get(id); return row ? store.decode<Artifact>(row) : null },
    insertArtifact: (artifact) => store.insert('artifact', artifact),
    saveArtifact(artifact) {
      lease.ensure()
      if (lease.foreign('output', artifact.id)) fail('FORBIDDEN')
      if (lease.active('output', artifact.id)) {
        const old = store.get<Artifact>('artifact', artifact.id)
        if (JSON.stringify(old.content) !== JSON.stringify(artifact.content)) fail('CONFLICT')
      }
      store.save('artifact', artifact)
    },
    removeArtifact(id) { lease.available('output', id); store.remove('artifact', id) },
    links: (id) => store.db.prepare('SELECT * FROM artifact_facts WHERE artifact_id=? ORDER BY block_id,fact_id').all(id).map((row) => store.decode<ArtifactFact>(row)),
    replaceLinks(id, links) {
      // Replace content and links inside the same enclosing business transaction.
      store.db.prepare('DELETE FROM artifact_facts WHERE artifact_id=?').run(id)
      for (const link of links) store.insert('artifact_fact', link)
    }
  }
}
