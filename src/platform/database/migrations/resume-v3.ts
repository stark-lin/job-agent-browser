import { removeFactEvidenceMigration } from './remove-fact-evidence'

const updateTriggers = removeFactEvidenceMigration.slice(
  removeFactEvidenceMigration.indexOf('CREATE TRIGGER guard_generation_runs_UPDATE'),
  removeFactEvidenceMigration.indexOf('UPDATE operation_receipts'))

/** Upgrade business state in place so all referencing rows and output paths keep their identity. */
export const resumeV3Migration = `
ALTER TABLE generation_runs ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id);
ALTER TABLE generation_runs ADD COLUMN state TEXT NOT NULL DEFAULT 'CREATED'
 CHECK(state IN ('CREATED','COPYING','REWRITING','VALIDATING','PUBLISHING','PUBLISHED','FAILED','CANCELLED','INTERRUPTED'));
ALTER TABLE generation_runs ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version>=0);
ALTER TABLE generation_runs ADD COLUMN rewrite_revision INTEGER NOT NULL DEFAULT 0 CHECK(rewrite_revision>=0);
ALTER TABLE generation_runs ADD COLUMN legacy_payload_json TEXT CHECK(legacy_payload_json IS NULL OR json_valid(legacy_payload_json));
DROP TRIGGER guard_generation_runs_UPDATE;
DROP TRIGGER audit_generation_runs_UPDATE;
UPDATE generation_runs SET state=CASE
 WHEN status='PENDING' THEN 'CREATED'
 WHEN status='RUNNING' THEN 'INTERRUPTED'
 WHEN status='SUCCEEDED' AND EXISTS (SELECT 1 FROM artifacts a WHERE a.generation_run_id=generation_runs.id) THEN 'PUBLISHED'
 WHEN status='SUCCEEDED' THEN 'FAILED'
 ELSE status END,
 error=CASE WHEN status='RUNNING' THEN 'PROCESS_INTERRUPTED'
 WHEN status='SUCCEEDED' AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.generation_run_id=generation_runs.id) THEN 'MISSING_LEGACY_ARTIFACT'
 ELSE error END,
 finished_at=CASE WHEN status='PENDING' THEN NULL ELSE COALESCE(finished_at,updated_at) END,
 legacy_payload_json=json_object('status',status,'stage',stage,'language',language,'scores',json(scores_json),'gate',json(gate_json),
 'selection',json(selection_json),'draft',json(draft_json),'polished',json(polished_json),'optimizationHash',optimization_hash);
ALTER TABLE generation_runs DROP COLUMN status;
ALTER TABLE generation_runs DROP COLUMN stage;
ALTER TABLE generation_runs DROP COLUMN language;
ALTER TABLE generation_runs DROP COLUMN scores_json;
ALTER TABLE generation_runs DROP COLUMN gate_json;
ALTER TABLE generation_runs DROP COLUMN selection_json;
ALTER TABLE generation_runs DROP COLUMN draft_json;
ALTER TABLE generation_runs DROP COLUMN polished_json;
ALTER TABLE generation_runs DROP COLUMN optimization_hash;
${updateTriggers}
CREATE UNIQUE INDEX resume_agent_run ON generation_runs(agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE TRIGGER immutable_legacy_generation BEFORE UPDATE OF legacy_payload_json ON generation_runs
WHEN NEW.legacy_payload_json IS NOT OLD.legacy_payload_json
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SNAPSHOT'); END;
CREATE TABLE resume_bullet_rewrites (
 run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, bullet_id TEXT NOT NULL,
 rewrite_revision INTEGER NOT NULL CHECK(rewrite_revision>=0), changed INTEGER NOT NULL CHECK(changed IN (0,1)),
 PRIMARY KEY(run_id,request_id)
) STRICT;
`
