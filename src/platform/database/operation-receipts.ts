import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { OperationReceipts } from '../../domain/common/receipts'
import { fail } from '../../domain/common/errors'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
const hash = (input: unknown) => createHash('sha256').update(canonical(input)).digest('hex')
export function operationReceipts(db: DatabaseSync): OperationReceipts {
  const transaction = () => { if (!db.isTransaction) fail('INVALID_STATE') }
  return {
    get<T>(operation: string, requestId: string, input: unknown): T | null {
      transaction()
      const row = db.prepare('SELECT * FROM operation_receipts WHERE operation=? AND request_id=?').get(operation, requestId)
      if (!row) return null
      if (row.input_hash !== hash(input)) fail('CONFLICT')
      const table = row.target_type === 'job' ? 'jobs' : 'job_events'
      if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.target_id)) fail('CONFLICT')
      return JSON.parse(String(row.result_json)) as T
    },
    put(operation, requestId, input, target, result) {
      transaction()
      db.prepare('INSERT INTO operation_receipts VALUES(?,?,?,?,?,?,?)').run(operation, requestId, hash(input), target, result.id, JSON.stringify(result), new Date().toISOString())
    }
  }
}
