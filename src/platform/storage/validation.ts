import { fail } from '../../domain/common/errors'

export function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) return fail('INVALID_INPUT')
  return input as Record<string, unknown>
}
