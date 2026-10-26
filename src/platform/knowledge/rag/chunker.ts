import { hash } from '../paths'
import type { KnowledgeChunk } from '../../../domain/knowledge'
export const approximateTokens = (s: string) =>
  (s.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0) +
  Math.ceil(s.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, '').length / 4)
interface Ast {
  type: string
  depth?: number
  value?: string
  children?: Ast[]
  position?: { start: { line: number }; end: { line: number } }
}
const plain = (n: Ast): string => n.value ?? n.children?.map(plain).join('') ?? ''
export async function chunkMarkdown(path: string, content: string): Promise<KnowledgeChunk[]> {
  const [{ unified }, { default: parse }, { default: gfm }] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-gfm')
  ])
  const ast = unified().use(parse).use(gfm).parse(content) as Ast,
    lines = content.split(/\r?\n/),
    headings: string[] = [],
    chunks: KnowledgeChunk[] = []
  let title = path.split('/').at(-1)!.replace(/\.md$/i, ''),
    start = 1,
    section: string[] = [],
    occurrence = 0
  const occurrences = new Map<string, number>()
  const flush = (end: number) => {
    if (end < start) return
    let local = 0,
      begin = start,
      text: string[] = []
    const add = (finish: number) => {
      const body = text.join('\n')
      if (body.trim())
        chunks.push({
          id: hash(`${path}\0${section.join('\0')}\0${occurrence}\0${local++}`),
          path,
          fileTitle: title,
          headingPath: [...section],
          chunkIndex: chunks.length,
          content: body,
          startLine: begin,
          endLine: finish,
          contentHash: hash(body)
        })
      text = []
    }
    for (let line = start; line <= end; line++) {
      const value = lines[line - 1]
      if (approximateTokens(value) > 900) {
        if (text.length) add(line - 1)
        const chars = Array.from(value)
        for (let offset = 0; offset < chars.length; offset += 700) {
          begin = line
          text = [chars.slice(offset, offset + 700).join('')]
          add(line)
        }
        begin = line + 1
        continue
      }
      if (text.length && approximateTokens(text.join('\n') + '\n' + value) > 900) {
        add(line - 1)
        begin = line
      }
      text.push(value)
      if (!value.trim() && approximateTokens(text.join('\n')) >= 450) {
        add(line)
        begin = line + 1
      }
    }
    if (text.length) add(end)
  }
  for (const node of ast.children ?? [])
    if (node.type === 'heading' && node.position) {
      const line = node.position.start.line
      flush(line - 1)
      const label = plain(node),
        depth = node.depth ?? 1
      if (depth === 1 && chunks.length === 0) title = label || title
      headings.splice(depth - 1)
      headings[depth - 1] = label
      section = headings.filter(Boolean)
      const key = section.join('\0')
      occurrence = occurrences.get(key) ?? 0
      occurrences.set(key, occurrence + 1)
      start = line
    }
  flush(lines.length)
  return chunks
}
