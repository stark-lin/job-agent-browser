import Ajv2020 from 'ajv/dist/2020'
import { toolFail, type ToolErrorCode } from '../../shared/tools/errors'
import type { JsonSchema, JsonValue, ToolOutput } from '../../shared/tools/tool.types'

export const limits = { schema: 65536, input: 65536, output: 1048576, depth: 32, nodes: 16384 } as const
/** Reject non-JSON values before serialization, including getters, cycles and implicit toJSON calls. */
export function jsonCopy(input: unknown, maximum: number, error: ToolErrorCode): JsonValue {
  let nodes = 0, bytes = 0
  const ancestors = new Set<object>()
  function visit(value: unknown, depth: number): void {
    if (++nodes > limits.nodes || depth > limits.depth) toolFail(error)
    if (typeof value === 'string') { bytes += Buffer.byteLength(value) + 2; if (bytes > maximum) toolFail(error); return }
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (!value || typeof value !== 'object' || ancestors.has(value) || Object.getOwnPropertySymbols(value).length) toolFail(error)
    if (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value) as object | null)) toolFail(error)
    if (Array.isArray(value) && Object.keys(value).length !== value.length) toolFail(error)
    ancestors.add(value)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue
      if (!descriptor.enumerable || descriptor.get || descriptor.set || ['__proto__', 'constructor', 'prototype'].includes(key)) toolFail(error)
      bytes += Buffer.byteLength(key) + 3
      if (bytes > maximum) toolFail(error)
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(input, 0)
  const encoded = JSON.stringify(input)
  if (Buffer.byteLength(encoded) > maximum) toolFail(error)
  return JSON.parse(encoded) as JsonValue
}
export function compileSchema(input: JsonSchema, objectInput = false): { schema: JsonSchema; validate(value: unknown): boolean } {
  const schema = jsonCopy(input, limits.schema, 'TOOL_INVALID_CONFIG') as JsonSchema
  if (!schema || Array.isArray(schema) || typeof schema !== 'object' || (objectInput && schema.type !== 'object')) toolFail('TOOL_INVALID_CONFIG')
  function references(value: unknown): void {
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if ((key === '$ref' && (typeof nested !== 'string' || !nested.startsWith('#'))) || key === '$dynamicRef' ||
        (key === '$schema' && nested !== 'https://json-schema.org/draft/2020-12/schema')) toolFail('TOOL_INVALID_CONFIG')
      references(nested)
    }
  }
  references(schema)
  try {
    const validate = new Ajv2020({ strict: true, allErrors: false, ownProperties: true, validateFormats: false,
      coerceTypes: false, useDefaults: false, removeAdditional: false, inlineRefs: false }).compile(schema)
    return { schema, validate: value => validate(value) === true }
  } catch { return toolFail('TOOL_INVALID_CONFIG') }
}
export function toolOutput(input: unknown, validate?: (value: unknown) => boolean): ToolOutput {
  const result = jsonCopy(input, limits.output, 'TOOL_INVALID_OUTPUT')
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
    Object.keys(result).some(key => !['content', 'structuredContent'].includes(key)) || !Array.isArray(result.content)) toolFail('TOOL_INVALID_OUTPUT')
  for (const item of result.content) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'text' || typeof item.text !== 'string' ||
      Object.keys(item).some(key => !['type', 'text'].includes(key))) toolFail('TOOL_UNSUPPORTED')
  }
  if (validate && (!Object.hasOwn(result, 'structuredContent') || !validate(result.structuredContent))) toolFail('TOOL_INVALID_OUTPUT')
  return result as unknown as ToolOutput
}
