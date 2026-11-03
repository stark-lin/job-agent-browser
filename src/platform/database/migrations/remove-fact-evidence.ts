/** V15 removes only retired Fact source attachments, including historical business copies. */
export const removeFactEvidenceMigration = `
DROP TRIGGER revision_facts_update;
ALTER TABLE facts DROP COLUMN evidence;
CREATE TRIGGER revision_facts_update AFTER UPDATE ON facts
WHEN NEW.profile_id IS NOT OLD.profile_id OR NEW.profile_item_id IS NOT OLD.profile_item_id
 OR NEW.kind IS NOT OLD.kind OR NEW.content IS NOT OLD.content OR NEW.tags_json IS NOT OLD.tags_json
BEGIN
 UPDATE profiles SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.profile_id;
 UPDATE profiles SET revision=revision+1 WHERE id=OLD.profile_id AND OLD.profile_id!=NEW.profile_id;
END;

-- Startup-only maintenance: preserve snapshot metadata, revisions and append-only audit history.
DROP TRIGGER immutable_snapshot;
DROP TRIGGER guard_generation_runs_UPDATE;
DROP TRIGGER audit_generation_runs_UPDATE;
UPDATE generation_runs SET input_snapshot_json=json_set(input_snapshot_json,'$.facts',json((
 SELECT json_group_array(json_remove(value,'$.evidence')) FROM json_each(input_snapshot_json,'$.facts')
)))
WHERE EXISTS (
 SELECT 1 FROM json_each(input_snapshot_json,'$.facts') WHERE json_type(value,'$.evidence') IS NOT NULL
);
CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON generation_runs
WHEN NEW.input_snapshot_json IS NOT OLD.input_snapshot_json OR NEW.job_id IS NOT OLD.job_id OR NEW.config_json IS NOT OLD.config_json
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END;
CREATE TRIGGER guard_generation_runs_UPDATE BEFORE UPDATE ON generation_runs
BEGIN SELECT CASE WHEN audit_context('active') != 'SUCCESS' THEN RAISE(ABORT, 'WRITE_CONTEXT_REQUIRED') END; END;
CREATE TRIGGER audit_generation_runs_UPDATE AFTER UPDATE ON generation_runs
BEGIN INSERT INTO audit_logs(id,event_type,action,timestamp,component,location,source,request_id,status,error,actor_id,target_type,target_id,transaction_id)
 VALUES(audit_uuid(),audit_context('event'),'UPDATE',audit_now(),'database',audit_context('event'),audit_context('source'),audit_context('requestId'),'SUCCESS',NULL,audit_context('actorId'),'generation_run',NEW.id,audit_context('transactionId'));
END;

UPDATE operation_receipts SET result_json=json_remove(result_json,'$.evidence')
WHERE target_type='fact' AND json_type(result_json,'$.evidence') IS NOT NULL;
`
