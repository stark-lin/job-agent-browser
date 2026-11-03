/** Additive Ask V2 checkpoints, separate from content-free business audit. */
export const askRuntimeMigration = `
ALTER TABLE chat_runs ADD COLUMN admission TEXT NOT NULL DEFAULT 'admitted' CHECK(admission IN ('pending','admitted'));
ALTER TABLE chat_runs ADD COLUMN runtime_status TEXT NOT NULL DEFAULT 'idle';
DROP INDEX chat_one_running;
CREATE UNIQUE INDEX chat_one_running ON chat_runs(session_id) WHERE state='running' AND admission='admitted';
CREATE TABLE chat_context_checkpoints (
 session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
 summary TEXT NOT NULL DEFAULT '', compacted_through_sequence INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0, protected_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(protected_json))
) STRICT;
CREATE TABLE chat_memory_progress (
 message_id TEXT PRIMARY KEY REFERENCES chat_items(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL, progress_json TEXT NOT NULL CHECK(json_valid(progress_json)), UNIQUE(session_id,sequence)
) STRICT;
`
