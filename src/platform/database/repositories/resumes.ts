import type { ResumeRepository } from '../../../domain/resume/resume.repository'
import type { Artifact, ArtifactFact, GenerationRun } from '../../../domain/resume/resume.types'
import type { Store } from './store'
import type { RuntimeLease } from '../runtime-leases'
import { isGenerating } from '../../../domain/resume/state-machine'
import { fail } from '../../../domain/common/errors'

export function resumeRepository(store: Store, lease: RuntimeLease): ResumeRepository {
  const activeRun = ({ legacyPayload: _legacy, ...run }: GenerationRun & { legacyPayload?: unknown }) => run
  const getRun = (id: string) => activeRun(store.get('generation_run', id))
  return {
    getRun, runs: (id, limit, offset) => {
      const page = store.list<GenerationRun>('generation_runs', id ? 'job_id=?' : '1=1', id ? [id] : [], 'created_at DESC, id', limit, offset)
      return { ...page, items: page.items.map(activeRun) }
    },
    insertRun(run) { store.insert('generation_run', run); lease.claim('generation', run.id) },
    requestRun(requestId, input) {
      const row = store.db.prepare('SELECT * FROM resume_start_receipts WHERE request_id=?').get(requestId)
      if (!row) return null
      if (row.runtime_id !== lease.id || row.input_json !== input) fail('CONFLICT')
      return getRun(String(row.run_id))
    },
    recordRequest(requestId, input, runId) { store.db.prepare('INSERT INTO resume_start_receipts VALUES(?,?,?,?)').run(requestId, lease.id, runId, input) },
    assertGeneration(id) { lease.assert('generation', id) },
    rewriteReceipt(runId, requestId) {
      const row = store.db.prepare('SELECT * FROM resume_bullet_rewrites WHERE run_id=? AND request_id=?').get(runId, requestId)
      return row ? { hash: String(row.request_hash), result: { runId, bulletId: String(row.bullet_id),
        rewriteRevision: Number(row.rewrite_revision), changed: Boolean(row.changed) } } : null
    },
    saveRewriteReceipt(requestId, hash, result) {
      store.db.prepare('INSERT INTO resume_bullet_rewrites VALUES(?,?,?,?,?,?)')
        .run(result.runId, requestId, hash, result.bulletId, result.rewriteRevision, Number(result.changed))
    },
    attachAgent(run, agentRunId, requestId, ownerRuntimeId) {
      lease.assert('generation', run.id)
      const owner = store.db.prepare('SELECT kind FROM runtime_instances WHERE id=?').get(ownerRuntimeId)
      if (owner?.kind !== 'internal' || !lease.live(ownerRuntimeId)) fail('FORBIDDEN')
      store.db.prepare(`INSERT INTO agent_runs(id,session_id,provider_id,model_id,state,request_id,request_hash,owner_runtime_id,created_at,agent,source)
        VALUES(?,NULL,?,?,'running',?,?,?,?,'resume','resume-generate')`)
        .run(agentRunId, run.config.providerId, run.config.modelId, requestId, run.id, ownerRuntimeId, run.updatedAt)
    },
    completedAgent(id) { return store.db.prepare("SELECT 1 FROM agent_runs WHERE id=? AND agent='resume' AND state='completed'").get(id) !== undefined },
    saveRun(run) { lease.assert('generation', run.id); store.save('generation_run', run) },
    removeRun(id) {
      const run = store.get<GenerationRun>('generation_run', id)
      if (isGenerating(run.state) && lease.foreign('generation', id)) fail('FORBIDDEN')
      const artifact = store.db.prepare('SELECT id FROM artifacts WHERE generation_run_id=?').get(id)
      if (artifact) lease.available('output', String(artifact.id))
      store.remove('generation_run', id)
      if (run.agentRunId) store.db.prepare('DELETE FROM agent_runs WHERE id=?').run(run.agentRunId)
    },
    running: () => store.db.prepare("SELECT * FROM generation_runs WHERE state IN ('CREATED','COPYING','REWRITING','VALIDATING','PUBLISHING') AND legacy_payload_json IS NULL").all()
      .map(row => activeRun(store.decode<GenerationRun>(row))).filter(run => !lease.active('generation', run.id))
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
