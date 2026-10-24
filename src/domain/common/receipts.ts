import type { TargetType } from './ports'
import { fail } from './errors'
import { id } from './validation'

export interface OperationReceipts {
  get<T>(operation: string, requestId: string, input: unknown): T | null
  put(operation: string, requestId: string, input: unknown, target: TargetType, result: { id: string }): void
}
/** Called inside the business write transaction, never around another service transaction. */
export function withReceipt<T extends { id: string }>(receipts: OperationReceipts | undefined, operation: string,
  requestId: string | undefined, input: unknown, target: TargetType, create: () => T): T {
  if (!requestId) return create()
  id(requestId)
  if (!receipts) fail('INVALID_STATE')
  const previous = receipts.get<T>(operation, requestId, input)
  if (previous) return previous
  const result = create()
  receipts.put(operation, requestId, input, target, result)
  return result
}
