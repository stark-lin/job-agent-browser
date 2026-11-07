import { createRequire } from 'node:module'
import type { encodingForModel as EncodingForModel } from 'js-tiktoken' with { 'resolution-mode': 'import' }
const { encodingForModel } = createRequire(__filename)('js-tiktoken') as { encodingForModel: typeof EncodingForModel }

/** Unknown tokenizers use UTF-8 bytes as a conservative content bound, never chars/4. */
export class TokenCounter {
  private encoder: ReturnType<typeof encodingForModel> | undefined
  private correction = 1
  constructor(modelId: string) {
    try { this.encoder = encodingForModel(modelId as Parameters<typeof encodingForModel>[0]) } catch { /* Conservative fallback. */ }
  }
  count(value: unknown): number {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
    return Math.ceil((this.encoder ? this.encoder.encode(text, [], []).length : new TextEncoder().encode(text).length) * this.correction)
  }
  observe(estimated: number, actual: number) {
    if (estimated > 0 && actual > estimated) this.correction *= actual / estimated * 1.05
  }
}
