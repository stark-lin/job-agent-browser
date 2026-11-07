/** Preserve historical receipts, including their original hash input, across the new rewrite contract. */
export const resumeOnceMigration = `
ALTER TABLE generation_runs DROP COLUMN rewrite_revision;
ALTER TABLE resume_bullet_rewrites RENAME TO legacy_resume_bullet_rewrites;
CREATE TABLE resume_bullet_rewrites (
 run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, bullet_id TEXT NOT NULL,
 changed INTEGER NOT NULL CHECK(changed IN (0,1)),
 legacy_expected_revision INTEGER CHECK(legacy_expected_revision>=0),
 PRIMARY KEY(run_id,request_id)
) STRICT;
INSERT INTO resume_bullet_rewrites(run_id,request_id,request_hash,bullet_id,changed,legacy_expected_revision)
 SELECT run_id,request_id,request_hash,bullet_id,changed,rewrite_revision-changed FROM legacy_resume_bullet_rewrites;
DROP TABLE legacy_resume_bullet_rewrites;
CREATE INDEX resume_changed_bullets ON resume_bullet_rewrites(run_id,bullet_id) WHERE changed=1;
`
