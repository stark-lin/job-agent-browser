// Additive v4 migration. Runtime ownership is separate from immutable business snapshots.
export const runtimeLeaseMigration = `
CREATE TABLE runtime_instances (
  id TEXT PRIMARY KEY, pid INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('internal','external')),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE runtime_work (
  kind TEXT NOT NULL CHECK(kind IN ('generation','output')), target_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL REFERENCES runtime_instances(id), token TEXT NOT NULL,
  PRIMARY KEY(kind,target_id)
) STRICT;
CREATE TABLE invocation_owners (
  invocation_id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL REFERENCES runtime_instances(id)
) STRICT;
CREATE TABLE resume_start_receipts (
  request_id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL REFERENCES runtime_instances(id),
  run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE, input_json TEXT NOT NULL
) STRICT;
`
