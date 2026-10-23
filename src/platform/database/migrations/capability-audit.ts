// Frozen version-3 SQL: extending errors or fields requires a new migration.
export const capabilityAuditMigration = `
CREATE TABLE capability_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('START','END')),
  timestamp TEXT NOT NULL, agent_id TEXT NOT NULL, run_id TEXT,
  tool_name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('read','write')),
  server_id TEXT, original_name TEXT, target_type TEXT, target_id TEXT,
  duration_ms INTEGER CHECK(duration_ms >= 0),
  status TEXT NOT NULL CHECK(status IN ('STARTED','SUCCESS','FAILURE','INTERRUPTED')),
  error TEXT CHECK(error IN ('TOOL_FORBIDDEN','TOOL_UNAVAILABLE','TOOL_CONFLICT','TOOL_INVALID_INPUT',
    'TOOL_INVALID_OUTPUT','TOOL_INVALID_CONFIG','TOOL_TIMEOUT','TOOL_CANCELLED','TOOL_EXECUTION_FAILED',
    'TOOL_UNSUPPORTED','TOOL_BUSY','TOOL_AUDIT_UNAVAILABLE','MCP_CONNECT_FAILED','MCP_INVALID_RESPONSE')),
  UNIQUE(invocation_id, phase),
  CHECK ((server_id IS NULL AND original_name IS NULL) OR (server_id IS NOT NULL AND original_name IS NOT NULL)),
  CHECK ((target_type IS NULL AND target_id IS NULL) OR (target_type IN ('job','profile','artifact') AND target_id IS NOT NULL)),
  CHECK ((phase='START' AND status='STARTED' AND error IS NULL AND duration_ms IS NULL) OR
    (phase='END' AND duration_ms IS NOT NULL AND ((status='SUCCESS' AND error IS NULL) OR (status IN ('FAILURE','INTERRUPTED') AND error IS NOT NULL))))
) STRICT;
CREATE INDEX capability_audit_time ON capability_audit(timestamp, sequence);
CREATE TRIGGER capability_audit_no_update BEFORE UPDATE ON capability_audit BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER capability_audit_no_delete BEFORE DELETE ON capability_audit BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER capability_audit_insert_context BEFORE INSERT ON capability_audit
WHEN capability_audit_allowed() != 1 BEGIN SELECT RAISE(ABORT,'AUDIT_CONTEXT_REQUIRED'); END;
CREATE TRIGGER capability_audit_end BEFORE INSERT ON capability_audit
WHEN NEW.phase='END' AND NOT EXISTS (SELECT 1 FROM capability_audit s WHERE s.invocation_id=NEW.invocation_id AND s.phase='START'
  AND s.agent_id=NEW.agent_id AND s.run_id IS NEW.run_id AND s.tool_name=NEW.tool_name AND s.mode=NEW.mode
  AND s.server_id IS NEW.server_id AND s.original_name IS NEW.original_name AND s.target_type IS NEW.target_type AND s.target_id IS NEW.target_id)
BEGIN SELECT RAISE(ABORT,'AUDIT_START_REQUIRED'); END;
`
