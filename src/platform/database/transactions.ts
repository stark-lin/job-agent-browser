import type { DatabaseSync } from 'node:sqlite'
import type { UnitOfWork } from '../../domain/common/ports'
import { DataError } from '../../domain/common/errors'
import { storageError } from './errors'

/** Synchronous business transactions; callbacks must never wait for asynchronous work. */
export class Transactions implements UnitOfWork {
  constructor(private readonly db: DatabaseSync) {}

  write<T>(operation: () => T): T { return this.execute('BEGIN IMMEDIATE', operation) }
  read<T>(operation: () => T): T { return this.execute('BEGIN', operation) }

  private execute<T>(begin: string, operation: () => T): T {
    if (this.db.isTransaction) throw new DataError('INVALID_STATE')
    try {
      this.db.exec(begin)
      const result = operation()
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) throw new DataError('INVALID_STATE')
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      const classified = storageError(error)
      if (this.db.isTransaction) {
        try { this.db.exec('ROLLBACK') } catch { /* Preserve the original business/storage failure. */ }
      }
      throw classified
    }
  }
}
