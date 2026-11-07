export const chatReactCyclesMigration = `
CREATE TABLE chat_react_cycles (
  run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  cycle_index INTEGER NOT NULL CHECK (cycle_index > 0),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','CONTINUE','WARNING','RECOVERING','SUCCESS','FAILED','CANCELLED')),
  reason TEXT,
  model_request_ordinal INTEGER CHECK (model_request_ordinal > 0),
  tool_call_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tool_call_ids_json) AND json_type(tool_call_ids_json)='array'),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK ((status='RUNNING') = (finished_at IS NULL)),
  PRIMARY KEY (run_id, cycle_index)
) STRICT;
CREATE UNIQUE INDEX chat_react_cycles_one_running ON chat_react_cycles(run_id) WHERE status='RUNNING';
`

// Version 16 is already applied on development databases. Keep its checksum stable.
export const chatReactCycleConstraintsMigration = `
CREATE TRIGGER chat_react_cycles_insert BEFORE INSERT ON chat_react_cycles
WHEN NEW.status <> 'RUNNING'
  OR NOT EXISTS (SELECT 1 FROM chat_runs WHERE id=NEW.run_id AND state='running' AND admission='admitted')
  OR NEW.cycle_index <> (SELECT COALESCE(MAX(cycle_index),0)+1 FROM chat_react_cycles WHERE run_id=NEW.run_id)
  OR EXISTS (SELECT 1 FROM chat_react_cycles WHERE run_id=NEW.run_id AND status IN ('SUCCESS','FAILED','CANCELLED'))
BEGIN SELECT RAISE(ABORT,'invalid cycle start'); END;

CREATE TRIGGER chat_react_cycles_update BEFORE UPDATE ON chat_react_cycles
WHEN OLD.status <> 'RUNNING' OR NEW.run_id <> OLD.run_id
  OR NEW.cycle_index <> OLD.cycle_index OR NEW.started_at <> OLD.started_at
  OR NOT EXISTS (SELECT 1 FROM chat_runs WHERE id=OLD.run_id AND state='running')
BEGIN SELECT RAISE(ABORT,'invalid cycle update'); END;

CREATE TRIGGER chat_react_cycles_delete BEFORE DELETE ON chat_react_cycles
WHEN EXISTS (SELECT 1 FROM chat_runs WHERE id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'cycle deletion requires run deletion'); END;
`
