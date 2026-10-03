import type { TargetType } from '../../../domain/common/ports'

export const entityTables: Record<TargetType, string> = {
  company: 'companies', job: 'jobs', job_source: 'job_sources', job_event: 'job_events',
  profile: 'profiles', profile_item: 'profile_items', fact: 'facts', generation_run: 'generation_runs',
  artifact: 'artifacts', artifact_fact: 'artifact_facts'
}

/** Audit never copies OLD/NEW business columns, only opaque primary keys. */
export function auditTriggers(): string {
  let sql = ''
  for (const [entity, table] of Object.entries(entityTables)) {
    const key = (prefix: string) => entity === 'artifact_fact'
      ? `json_array(${prefix}.artifact_id, ${prefix}.block_id, ${prefix}.fact_id)` : `${prefix}.id`
    for (const [operation, action] of [['INSERT', 'CREATE'], ['UPDATE', 'UPDATE'], ['DELETE', 'DELETE']] as const) {
      const target = key(operation === 'DELETE' ? 'OLD' : 'NEW')
      sql += `
        CREATE TRIGGER guard_${table}_${operation} BEFORE ${operation} ON ${table}
        BEGIN SELECT CASE WHEN audit_context('active') != 'SUCCESS' THEN RAISE(ABORT, 'WRITE_CONTEXT_REQUIRED') END; END;
        CREATE TRIGGER audit_${table}_${operation} AFTER ${operation} ON ${table}
        BEGIN INSERT INTO audit_logs(id,event_type,action,timestamp,component,location,source,request_id,status,error,actor_id,target_type,target_id,transaction_id)
          VALUES(audit_uuid(),audit_context('event'),'${action}',audit_now(),'database',audit_context('event'),audit_context('source'),audit_context('requestId'),'SUCCESS',NULL,audit_context('actorId'),'${entity}',${target},audit_context('transactionId'));
        END;
      `
    }
    // Artifact links are associations: removing/re-adding a link is valid, unlike reusing an entity ID.
    if (entity !== 'artifact_fact') sql += `
      CREATE TRIGGER identity_${table} BEFORE UPDATE ON ${table} WHEN NEW.id != OLD.id
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ID'); END;
      CREATE TRIGGER reuse_${table} BEFORE INSERT ON ${table}
      WHEN EXISTS(SELECT 1 FROM audit_logs WHERE target_type='${entity}' AND target_id=NEW.id AND action='DELETE' AND status='SUCCESS')
      BEGIN SELECT RAISE(ABORT, 'DELETED_ID'); END;
    `
  }
  return sql + `
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
    CREATE TRIGGER audit_insert_context BEFORE INSERT ON audit_logs
    WHEN audit_context('active') NOT IN ('SUCCESS','FAILURE') OR NEW.status != audit_context('active')
      OR NEW.request_id != audit_context('requestId') OR NEW.transaction_id != audit_context('transactionId')
    BEGIN SELECT RAISE(ABORT, 'AUDIT_CONTEXT_REQUIRED'); END;
  `
}
