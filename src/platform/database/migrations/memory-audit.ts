import { knowledgeAuditMigration } from './knowledge-audit'
// Preserve all historical rows and guards; add only the opaque Memory audit target.
export const memoryAuditMigration = knowledgeAuditMigration.replace("'artifact','knowledge'", "'artifact','knowledge','memory'")
