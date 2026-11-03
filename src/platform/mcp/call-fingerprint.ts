import { createHash } from 'node:crypto'
/** Inputs must already be bounded JSON. Arrays retain their business ordering. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const callDigest = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')
