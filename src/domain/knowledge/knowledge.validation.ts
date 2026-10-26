import { KnowledgeError } from './knowledge.types'
export const MAX_FILE_BYTES = 512 * 1024
export function knowledgePath(value: unknown, root = false): string {
  if (root && value === '') return ''
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !value ||
    value !== value.normalize('NFC') ||
    value.includes('\\') ||
    /^[/.]/.test(value) ||
    /[\x00-\x1f\x7f:<>"|?*]/.test(value)
  )
    throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
  const parts = value.split('/')
  if (
    parts.length > 32 ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        p.startsWith('.') ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p) ||
        p.length > 200
    )
  )
    throw new KnowledgeError('KNOWLEDGE_INVALID_PATH')
  return value
}
export function markdownPath(value: unknown) {
  const path = knowledgePath(value)
  if (!/\.md$/i.test(path)) throw new KnowledgeError('KNOWLEDGE_UNSUPPORTED_FILE')
  return path
}
export function revision(value: unknown): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))
    throw new KnowledgeError('KNOWLEDGE_CONFLICT')
}
