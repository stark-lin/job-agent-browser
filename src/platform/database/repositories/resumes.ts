import type { ResumeRepository } from '../../../domain/resume/resume.repository'
import type { Artifact, ArtifactFact, GenerationRun } from '../../../domain/resume/resume.types'
import type { Store } from './store'

export function resumeRepository(store: Store): ResumeRepository {
  return {
    getRun: (id) => store.get('generation_run', id), runs: (id, limit, offset) => store.list('generation_runs', id ? 'job_id=?' : '1=1', id ? [id] : [], 'created_at DESC, id', limit, offset),
    insertRun: (run) => store.insert('generation_run', run), saveRun: (run) => store.save('generation_run', run), removeRun: (id) => store.remove('generation_run', id),
    running: () => store.db.prepare("SELECT * FROM generation_runs WHERE status='RUNNING'").all().map((row) => store.decode<GenerationRun>(row)),
    getArtifact: (id) => store.get('artifact', id),
    artifactForRun(id) { const row = store.db.prepare('SELECT * FROM artifacts WHERE generation_run_id=?').get(id); return row ? store.decode<Artifact>(row) : null },
    insertArtifact: (artifact) => store.insert('artifact', artifact), saveArtifact: (artifact) => store.save('artifact', artifact), removeArtifact: (id) => store.remove('artifact', id),
    links: (id) => store.db.prepare('SELECT * FROM artifact_facts WHERE artifact_id=? ORDER BY block_id,fact_id').all(id).map((row) => store.decode<ArtifactFact>(row)),
    replaceLinks(id, links) {
      // Replace content and links inside the same enclosing business transaction.
      store.db.prepare('DELETE FROM artifact_facts WHERE artifact_id=?').run(id)
      for (const link of links) store.insert('artifact_fact', link)
    }
  }
}
