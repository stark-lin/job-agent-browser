// V22 removes only the known legacy audit objects; business constraints keep their identities.
const tables = ['companies', 'jobs', 'job_sources', 'job_events', 'profiles', 'profile_items', 'facts', 'generation_runs', 'artifacts', 'artifact_facts']
const triggers = tables.flatMap(table => [
  ...['INSERT', 'UPDATE', 'DELETE'].flatMap(operation => [`guard_${table}_${operation}`, `audit_${table}_${operation}`]),
  ...(table === 'artifact_facts' ? [] : [`reuse_${table}`])
]).concat(['audit_no_update', 'audit_no_delete', 'audit_insert_context',
  'capability_audit_no_update', 'capability_audit_no_delete', 'capability_audit_insert_context', 'capability_audit_end'])

export const removeAuditMigration = triggers.map(name => `DROP TRIGGER IF EXISTS ${name};`).join('\n') + `
DROP TABLE invocation_owners;
DROP TABLE capability_audit;
DROP TABLE audit_logs;
`
