import { capabilityAuditMigration } from './capability-audit'
// Preserve every immutable row and sequence. Only the allowed opaque target types change.
const [table, guards] = capabilityAuditMigration.split('CREATE INDEX capability_audit_time')
export const knowledgeAuditMigration =
  table
    .replace('CREATE TABLE capability_audit (', 'CREATE TABLE capability_audit_next (')
    .replace("'job','profile','artifact'", "'job','profile','artifact','knowledge'") +
  `
INSERT INTO capability_audit_next SELECT * FROM capability_audit;
DROP TABLE capability_audit;
ALTER TABLE capability_audit_next RENAME TO capability_audit;
CREATE INDEX capability_audit_time` +
  guards
