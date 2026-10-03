import { fail } from './errors'

export type Parser<T> = (input: unknown) => T
export type Parsed<P> = P extends Parser<infer T> ? T : never
type Shape = Record<string, Parser<unknown>>

export function object<S extends Shape>(shape: S): Parser<{ [K in keyof S]: Parsed<S[K]> }> {
  return (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT')
    const value = input as Record<string, unknown>
    if (Object.keys(value).some((key) => !Object.hasOwn(shape, key))) fail('INVALID_INPUT')
    return Object.fromEntries(Object.entries(shape).map(([key, parse]) => [key, parse(value[key])])) as { [K in keyof S]: Parsed<S[K]> }
  }
}

export const text = (max = 1000, min = 0): Parser<string> => (value) => {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min || value.includes('\0')) fail('INVALID_INPUT')
  return value
}
export const integer = (min: number, max: number): Parser<number> => (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_INPUT')
  return value
}
export const number: Parser<number> = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('INVALID_INPUT')
  return value
}
export const boolean: Parser<boolean> = (value) => {
  if (typeof value !== 'boolean') fail('INVALID_INPUT')
  return value
}
export const choice = <const T extends string>(values: readonly T[]): Parser<T> => (value) => {
  if (typeof value !== 'string' || !values.includes(value as T)) fail('INVALID_INPUT')
  return value as T
}
export const optional = <T>(parse: Parser<T>, fallback: T): Parser<T> => (value) => value === undefined ? structuredClone(fallback) : parse(value)
export const nullable = <T>(parse: Parser<T>): Parser<T | null> => (value) => value === null ? null : parse(value)
export const array = <T>(parse: Parser<T>, max = 200): Parser<T[]> => (value) => {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT')
  return value.map(parse)
}
export const id: Parser<string> = (value) => {
  const result = text(36, 36)(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) fail('INVALID_INPUT')
  return result
}
export const timestamp: Parser<string> = (value) => {
  const result = text(24, 24)(value)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail('INVALID_INPUT')
  return result
}
export const date: Parser<string> = (value) => {
  const result = text(10, 10)(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail('INVALID_INPUT')
  timestamp(`${result}T00:00:00.000Z`)
  return result
}
export const url: Parser<string> = (value) => {
  const result = text(4096, 1)(value)
  try {
    const parsed = new URL(result)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('INVALID_INPUT')
  } catch { fail('INVALID_INPUT') }
  return result
}
export const optionalText = (max = 1000) => optional(text(max), '')
export const optionalUrl = optional<string>((value) => value === '' ? '' : url(value), '')
export const optionalId = optional(nullable(id), null)
export const pageFields = { limit: optional(integer(1, 100), 25), offset: optional(integer(0, 1_000_000), 0) }
export const page = object(pageFields)
export const byId = object({ id })

export function unique(ids: string[]): void {
  if (new Set(ids).size !== ids.length) fail('INVALID_INPUT')
}
