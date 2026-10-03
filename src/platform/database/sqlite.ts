import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrate } from './migrations'
import { Transactions } from './transactions'

/** Platform-internal connection. Domain and Renderer only see business capabilities. */
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false })
  try {
    connection.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA recursive_triggers=ON;')
    const transactions = new Transactions(connection)
    migrate(connection)
    transactions.protectAudit()
    return { connection, transactions, close: () => connection.close() }
  } catch (error) { connection.close(); throw error }
}
