import { initialSchema } from './schema'
import { auditTriggers, entityTables } from './audit-triggers'

// Freeze version-2 error values here: future enum additions require another migration.
const additionalErrors = ['ENCRYPTION_UNAVAILABLE', 'AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED',
  'AI_PROVIDER_FAILED', 'AI_PROTOCOL_ERROR', 'AI_CONNECT_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED']
const auditTable = initialSchema.slice(initialSchema.indexOf('CREATE TABLE audit_logs'), initialSchema.indexOf('CREATE INDEX companies_name'))
  .replace('CREATE TABLE audit_logs', 'CREATE TABLE audit_logs_next')
  .replace("'FORBIDDEN'))", "'FORBIDDEN'," + additionalErrors.map(code => `'${code}'`).join(',') + '))')
const dropTriggers = Object.entries(entityTables).flatMap(([entity, table]) => [
  ...['INSERT', 'UPDATE', 'DELETE'].flatMap(operation => [`guard_${table}_${operation}`, `audit_${table}_${operation}`]),
  ...(entity === 'artifact_fact' ? [] : [`identity_${table}`, `reuse_${table}`])
]).concat(['audit_no_update', 'audit_no_delete', 'audit_insert_context']).map(name => `DROP TRIGGER ${name};`).join('\n')

export const aiAuditMigration = dropTriggers + auditTable + `
INSERT INTO audit_logs_next SELECT * FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_next RENAME TO audit_logs;
CREATE INDEX audit_target ON audit_logs(target_type, target_id, sequence);
CREATE INDEX audit_transaction ON audit_logs(transaction_id, sequence);
CREATE INDEX audit_request ON audit_logs(request_id, sequence);
CREATE INDEX audit_time ON audit_logs(timestamp, sequence);
CREATE UNIQUE INDEX audit_ai_request ON audit_logs(request_id) WHERE target_type='ai_request' AND event_type='AI_STREAM_START';
` + auditTriggers()
