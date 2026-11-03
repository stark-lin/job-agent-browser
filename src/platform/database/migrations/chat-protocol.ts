/** Provider continuation capsules are Host-only and cascade with their chat. */
export const chatProtocolMigration = `
CREATE TABLE chat_provider_responses (
 run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL CHECK(ordinal>0), through_sequence INTEGER NOT NULL,
 response_json TEXT NOT NULL CHECK(json_valid(response_json)), PRIMARY KEY(run_id,ordinal)
) STRICT;
`
