export const askPhasesMigration = `
ALTER TABLE agent_items ADD COLUMN phase TEXT NOT NULL DEFAULT 'execute' CHECK (phase IN ('prepare','execute'));
ALTER TABLE agent_model_requests ADD COLUMN phase TEXT NOT NULL DEFAULT 'execute' CHECK (phase IN ('prepare','execute'));
ALTER TABLE agent_model_responses ADD COLUMN phase TEXT NOT NULL DEFAULT 'execute' CHECK (phase IN ('prepare','execute'));
ALTER TABLE agent_model_responses ADD COLUMN cycle_index INTEGER CHECK (cycle_index > 0);
ALTER TABLE agent_react_cycles ADD COLUMN phase TEXT NOT NULL DEFAULT 'execute' CHECK (phase IN ('prepare','execute'));

CREATE TABLE agent_run_preparations (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ready','blocked')),
  prompt TEXT,
  reason TEXT,
  finished_at TEXT NOT NULL,
  CHECK ((status='ready' AND prompt IS NOT NULL AND reason IS NULL)
    OR (status='blocked' AND reason IS NOT NULL AND prompt IS NULL))
) STRICT;

DROP TRIGGER agent_react_cycles_insert;
DROP TRIGGER agent_react_cycles_update;

CREATE TRIGGER agent_react_cycles_insert BEFORE INSERT ON agent_react_cycles
WHEN NEW.status <> 'RUNNING'
  OR NOT EXISTS (SELECT 1 FROM agent_runs WHERE id=NEW.run_id AND state='running' AND admission='admitted'
    AND (NEW.phase='execute' OR agent='ask'))
  OR NEW.cycle_index <> (SELECT COALESCE(MAX(cycle_index),0)+1 FROM agent_react_cycles WHERE run_id=NEW.run_id)
  OR EXISTS (SELECT 1 FROM agent_react_cycles WHERE run_id=NEW.run_id AND status IN ('FAILED','CANCELLED'))
  OR EXISTS (SELECT 1 FROM agent_react_cycles WHERE run_id=NEW.run_id AND phase='execute'
    AND (NEW.phase='prepare' OR status='SUCCESS'))
  OR (EXISTS (SELECT 1 FROM agent_react_cycles WHERE run_id=NEW.run_id AND phase='prepare' AND status='SUCCESS')
    AND NEW.phase='prepare')
  OR (NEW.phase='execute' AND EXISTS (SELECT 1 FROM agent_react_cycles WHERE run_id=NEW.run_id AND phase='prepare')
    AND NOT EXISTS (
      SELECT 1 FROM agent_run_preparations p JOIN agent_react_cycles c ON c.run_id=p.run_id
      WHERE p.run_id=NEW.run_id AND p.status='ready' AND c.phase='prepare' AND c.status='SUCCESS'))
BEGIN SELECT RAISE(ABORT,'invalid cycle start'); END;

CREATE TRIGGER agent_react_cycles_update BEFORE UPDATE ON agent_react_cycles
WHEN OLD.status <> 'RUNNING' OR NEW.run_id <> OLD.run_id OR NEW.phase <> OLD.phase
  OR NEW.cycle_index <> OLD.cycle_index OR NEW.started_at <> OLD.started_at
  OR NOT EXISTS (SELECT 1 FROM agent_runs WHERE id=OLD.run_id AND state='running')
BEGIN SELECT RAISE(ABORT,'invalid cycle update'); END;
`
