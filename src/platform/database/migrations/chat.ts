/** Additive V6: host transcript storage, separate from content-free business capability audit. */
export const chatMigration = `
CREATE TABLE chat_sessions (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE chat_runs (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','failed','cancelled','interrupted')),
 error TEXT, event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence>=0),
 write_started INTEGER NOT NULL DEFAULT 0 CHECK(write_started IN (0,1)),
 request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 owner_runtime_id TEXT NOT NULL REFERENCES runtime_instances(id),
 created_at TEXT NOT NULL, finished_at TEXT,
 CHECK((state='running' AND finished_at IS NULL) OR (state!='running' AND finished_at IS NOT NULL)),
 UNIQUE(id,session_id)
) STRICT;
CREATE UNIQUE INDEX chat_one_running ON chat_runs(session_id) WHERE state='running';
CREATE INDEX chat_sessions_updated ON chat_sessions(updated_at DESC,id);
CREATE INDEX chat_runs_session ON chat_runs(session_id,created_at,id);
CREATE TABLE chat_items (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
 state TEXT NOT NULL CHECK(state IN ('streaming','running','completed','failed','cancelled','uncertain','interrupted')),
 content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_type(content_json,'$.type') IS 'text'
  AND json_extract(content_json,'$.type') IN ('user_message','assistant_message','reasoning','tool_call')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(run_id,session_id) REFERENCES chat_runs(id,session_id) ON DELETE CASCADE,
 UNIQUE(session_id,sequence)
) STRICT;
CREATE INDEX chat_items_run ON chat_items(run_id,sequence);
`
