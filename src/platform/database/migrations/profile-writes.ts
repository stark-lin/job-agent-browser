/** One aggregate revision covers every UI, import and MCP mutation, including cascades. */
export const profileWriteMigration = `
ALTER TABLE profiles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);
CREATE TRIGGER profile_revision AFTER UPDATE OF name,email,phone,location,links_json,introduction ON profiles
WHEN NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email OR NEW.phone IS NOT OLD.phone
 OR NEW.location IS NOT OLD.location OR NEW.links_json IS NOT OLD.links_json OR NEW.introduction IS NOT OLD.introduction
BEGIN UPDATE profiles SET revision=OLD.revision+1 WHERE id=NEW.id; END;
${['profile_items', 'facts'].map(table => {
  const fields = table === 'facts' ? ['profile_id', 'profile_item_id', 'kind', 'content', 'tags_json', 'evidence']
    : ['profile_id', 'parent_item_id', 'type', 'title', 'organization', 'role', 'location', 'start_date', 'end_date', 'summary', 'sort_order', 'metadata_json']
  const touch = (ref: string) => `UPDATE profiles SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${ref}.profile_id;`
  return `CREATE TRIGGER revision_${table}_insert AFTER INSERT ON ${table} BEGIN ${touch('NEW')} END;
CREATE TRIGGER revision_${table}_delete AFTER DELETE ON ${table} BEGIN ${touch('OLD')} END;
CREATE TRIGGER revision_${table}_update AFTER UPDATE ON ${table}
WHEN ${fields.map(field => `NEW.${field} IS NOT OLD.${field}`).join(' OR ')}
BEGIN ${touch('NEW')} UPDATE profiles SET revision=revision+1 WHERE id=OLD.profile_id AND OLD.profile_id!=NEW.profile_id; END;`
}).join('\n')}
ALTER TABLE operation_receipts RENAME TO old_operation_receipts;
CREATE TABLE operation_receipts (
 operation TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
 target_type TEXT NOT NULL CHECK(target_type IN ('job','job_event','profile','profile_item','fact')), target_id TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(operation,request_id)
) STRICT;
INSERT INTO operation_receipts SELECT * FROM old_operation_receipts;
DROP TABLE old_operation_receipts;
`
