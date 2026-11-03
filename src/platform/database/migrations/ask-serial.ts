import { memoryAuditMigration } from './memory-audit'

/** Retire Memory lifecycle flags; keep legacy progress rows without replaying their intents. */
export const askSerialMigration = memoryAuditMigration.replace("'TOOL_FORBIDDEN','TOOL_UNAVAILABLE'", "'TOOL_NOT_FOUND','TOOL_FORBIDDEN','TOOL_UNAVAILABLE'") + `
UPDATE chat_runs SET runtime_status='idle',event_sequence=event_sequence+1
WHERE runtime_status IN ('memory.updating','memory.failed');
`
