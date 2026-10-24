export const operationReceiptMigration = `
CREATE TABLE operation_receipts (
  operation TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('job','job_event')), target_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL,
  PRIMARY KEY(operation,request_id)
) STRICT;
`
