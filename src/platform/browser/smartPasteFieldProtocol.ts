export const FIELD_COMMAND = 'smart-paste:field-command'
export const FIELD_REPLY = 'smart-paste:field-reply'
export const FIELD_INVALID = 'smart-paste:field-invalid'

export interface FieldContext {
  label: string
  placeholder: string
  type: string
  currentValue: string
  nearbyText: string
  frameTitle: string
}
export type FieldOperation =
  | { type: 'probe' }
  | { type: 'begin' | 'rollback' | 'finish'; target: string }
  | { type: 'append'; target: string; text: string }

export interface FieldCommand {
  id: string
  operation: FieldOperation
}
