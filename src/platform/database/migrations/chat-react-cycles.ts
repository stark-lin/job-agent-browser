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
