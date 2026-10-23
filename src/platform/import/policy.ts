import { fail } from '../../domain/common/errors'
import { allowsParallelImport, type AIChoice, type AISettings } from '../../shared/ai'
import * as v from '../../domain/common/validation'
import type { ImportMode } from '../../shared/import'

export const importMode = v.optional(v.choice(['single', 'parallel']), 'single')
export function checkImportMode(settings: AISettings | undefined, choice: AIChoice, mode: ImportMode): void {
  if (mode === 'parallel' && !allowsParallelImport(settings ?? null, choice)) fail('INVALID_INPUT')
}
