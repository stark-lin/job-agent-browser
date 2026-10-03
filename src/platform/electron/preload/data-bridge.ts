import { methodNames, type DataAPI } from '../data-contract'
import type { Result } from '../../../shared/ipc'

export type DataInvoker = (group: string, method: string, input: unknown) => Promise<Result<unknown>>

export function createDataBridge(invoke: DataInvoker): DataAPI {
  // The mapped API is assembled only from its compile-time allowlist; no generic invoke is exposed.
  return Object.fromEntries(Object.entries(methodNames).map(([group, names]) => [group,
    Object.fromEntries(names.map((method) => [method, (input: unknown) => invoke(group, method, input)]))
  ])) as DataAPI
}
