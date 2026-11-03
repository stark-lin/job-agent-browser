/** Deletable conversation diagnostics; no audit tables or triggers are changed. */
export const chatModelRequestsMigration = `
CREATE TABLE chat_model_requests (
 run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal>0),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 activations_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(activations_json)),
 PRIMARY KEY(run_id,ordinal)
) STRICT;
`
