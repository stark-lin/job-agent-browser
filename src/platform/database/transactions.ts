import { constants, type DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Command, TargetType, UnitOfWork } from '../../domain/common/ports'
import { DataError } from '../../domain/common/errors'
import { storageError } from './errors'

export type Actor = 'USER' | 'AI' | 'SYSTEM'
const identities = { USER: ['local-user', 'RENDERER'], AI: ['generation-service', 'GENERATOR'], SYSTEM: ['system', 'STARTUP'] } as const
interface Context extends Command {
  active: 'SUCCESS' | 'FAILURE'; requestId: string; transactionId: string; actorId: string; source: string
}

export class Transactions {
  private context: Context | null = null
  constructor(private readonly db: DatabaseSync) {
    db.function('audit_uuid', () => randomUUID())
    db.function('audit_now', () => new Date().toISOString())
    db.function('audit_context', (key) => {
      if (!this.context || !db.isTransaction) return ''
      if (typeof key !== 'string' || !Object.hasOwn(this.context, key)) return ''
      return this.context[key as keyof Context] ?? ''
    })
  }

  protectAudit(): void {
    // Authorizer checks the SQL origin; callers cannot insert forged success records directly.
    this.db.setAuthorizer((action, table, _column, _database, trigger) => {
      if (table === 'audit_logs') {
        if (action === constants.SQLITE_UPDATE || action === constants.SQLITE_DELETE) return constants.SQLITE_DENY
        if (action === constants.SQLITE_INSERT && !trigger?.startsWith('audit_') && this.context?.active !== 'FAILURE') return constants.SQLITE_DENY
      }
      return constants.SQLITE_OK
    })
  }

  forActor(actor: Actor): UnitOfWork {
    return { write: (command, operation) => this.write(actor, command, operation), read: (operation) => this.read(operation) }
  }

  target(type: TargetType, id: string): void {
    if (this.context?.target === type && !this.context.targetId) this.context.targetId = id
  }

  private synchronous<T>(operation: () => T): T {
    const result = operation()
    if (result && typeof result === 'object' && 'then' in result) throw new DataError('INVALID_STATE')
    return result
  }

  private write<T>(actor: Actor, command: Command, operation: () => T): T {
    if (this.context || this.db.isTransaction) throw new DataError('INVALID_STATE')
    const [actorId, source] = identities[actor]
    const context: Context = { ...command, active: 'SUCCESS', actorId, source, requestId: randomUUID(), transactionId: randomUUID() }
    this.context = context
    try {
      this.db.exec('BEGIN IMMEDIATE')
      const result = this.synchronous(operation)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      const classified = storageError(error)
      try {
        if (this.db.isTransaction) this.db.exec('ROLLBACK')
        this.appendFailure(context, classified)
      } catch {
        // A full/locked/unavailable database cannot promise a durable failure record.
        throw new DataError('AUDIT_UNAVAILABLE')
      }
      throw classified
    } finally { this.context = null }
  }

  private appendFailure(context: Context, error: DataError): void {
    this.context = { ...context, active: 'FAILURE', transactionId: randomUUID() }
    try {
      this.db.exec('BEGIN IMMEDIATE')
      this.db.prepare(`INSERT INTO audit_logs(id,event_type,action,timestamp,component,location,source,request_id,status,error,actor_id,target_type,target_id,transaction_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), context.event, context.action, new Date().toISOString(), 'database', context.event,
          context.source, context.requestId, 'FAILURE', error.code, context.actorId, context.target, context.targetId ?? null, this.context.transactionId)
      this.db.exec('COMMIT')
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error }
  }

  private read<T>(operation: () => T): T {
    if (this.db.isTransaction) throw new DataError('INVALID_STATE')
    try {
      this.db.exec('BEGIN')
      const result = this.synchronous(operation)
      this.db.exec('COMMIT')
      return result
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw storageError(error) }
  }
}
