import manifest from '../../../../resources/embedding-model.json'
import type { EmbeddingPurpose } from './embedding'

export { manifest }
export const embeddingIdentity = JSON.stringify({
  provider: 'builtin', model: manifest.id, revision: manifest.revision, dtype: manifest.dtype,
  dimensions: manifest.dimensions, pooling: manifest.pooling, normalize: manifest.normalize,
  maxLength: manifest.maxLength, prefixVersion: manifest.prefixVersion
})
export interface EmbeddingRequest { id: string; texts: string[]; purpose: EmbeddingPurpose; modelsDirectory: string }
export type EmbeddingResponse = { id: string; ok: true; vectors: number[][] } | { id: string; ok: false }
export function validVectors(value: unknown, count: number): value is number[][] {
  return Array.isArray(value) && value.length === count && value.every(v =>
    Array.isArray(v) && v.length === manifest.dimensions && v.every(n => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(Math.hypot(...v) - 1) < 0.01)
}
