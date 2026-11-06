/** Add ordering and content revisions without rewriting old runs or output files. */
export const resumeModuleMigration = `
ALTER TABLE generation_runs ADD COLUMN assembled_json TEXT CHECK(assembled_json IS NULL OR json_valid(assembled_json));
ALTER TABLE generation_runs ADD COLUMN optimization_hash TEXT;
ALTER TABLE artifacts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);
ALTER TABLE facts ADD COLUMN sort_order INTEGER CHECK(sort_order >= 0);
CREATE TABLE profile_order_counters (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  next_item INTEGER NOT NULL, next_fact INTEGER NOT NULL
) STRICT;
`
