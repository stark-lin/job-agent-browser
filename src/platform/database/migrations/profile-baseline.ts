/** V23: mutable working profiles and independently approved immutable baselines. */
export const profileBaselineMigration = `
ALTER TABLE profiles ADD COLUMN title TEXT NOT NULL DEFAULT '';
UPDATE profiles SET title=CASE WHEN trim(name)='' THEN 'Profile' ELSE name END;
DROP TRIGGER profile_revision;
CREATE TRIGGER profile_revision AFTER UPDATE OF title,name,email,phone,location,links_json,introduction ON profiles
WHEN NEW.title IS NOT OLD.title OR NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email OR NEW.phone IS NOT OLD.phone
 OR NEW.location IS NOT OLD.location OR NEW.links_json IS NOT OLD.links_json OR NEW.introduction IS NOT OLD.introduction
BEGIN UPDATE profiles SET revision=OLD.revision+1 WHERE id=NEW.id; END;
CREATE TABLE profile_baselines (
 profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 schema_version INTEGER NOT NULL CHECK(schema_version = 1),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER immutable_profile_baseline BEFORE UPDATE ON profile_baselines
BEGIN SELECT RAISE(ABORT, 'immutable profile baseline'); END;
`
