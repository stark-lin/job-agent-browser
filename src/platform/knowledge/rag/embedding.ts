export type EmbeddingPurpose = 'query' | 'document'
export interface EmbeddingProvider {
  identity(): string | null
  error?(): string | null
  cancel?(): void
  dispose?(): Promise<void>
  embed(texts: string[], purpose: EmbeddingPurpose, signal: AbortSignal): Promise<number[][]>
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0
  let dot = 0,
    x = 0,
    y = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    x += a[i] * a[i]
    y += b[i] * b[i]
  }
  return x && y ? dot / Math.sqrt(x * y) : 0
}
