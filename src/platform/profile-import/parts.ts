import type { ImportDraft } from '../../domain/candidate/import.types'
import type { ImportMode } from '../../shared/import'
import type { ImportPart } from '../import/batch'
import { importPrompt, parseImportDraft, parseRawImport } from './draft'
import { ImportFailure, type PdfPage } from './pdf'

type Raw = ReturnType<typeof parseRawImport>
const empty = () => ({ contact: {}, links: [], items: [], facts: [] })
export function profileParts(pages: PdfPage[], mode: ImportMode): ImportPart<Raw>[] {
  const prompt = importPrompt(pages)
  const parse = (text: string) => {
    try { return parseRawImport(text) } catch { throw new ImportFailure('IMPORT_INVALID_OUTPUT') }
  }
  if (mode === 'single') return [{ id: 'single', prompt, parse }]
  return [
    { id: 'contact' as const, type: null }, { id: 'experience' as const, type: 'EXPERIENCE' },
    { id: 'projects' as const, type: 'PROJECT' }, { id: 'education' as const, type: 'EDUCATION' }
  ].map(({ id, type }) => ({ id,
    prompt: `This is the ${id} extraction group. ${type
      ? `Return ONLY {"items":[...]} containing ${type} entries and their nested facts. Do not return contact, links, standalone facts or other item types.`
      : 'Return ONLY {"contact":{...},"links":[],"facts":[]}. Standalone facts must not belong to any experience, project or education entry. Those entries and all their facts are handled by separate requests.'}
Follow the field rules below, replacing the top-level response shape with your group shape.\n${prompt.replace('Return exactly', 'Field schema reference; emit only your assigned group:')}`,
    parse(text): Raw {
      try {
        const raw: unknown = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''))
        const keys = type ? ['items'] : ['contact', 'links', 'facts']
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(raw, key))) throw new Error()
        const result = parseRawImport(JSON.stringify({ ...empty(), ...raw }))
        if (type && result.items.some(item => item.type !== type)) throw new Error()
        return result
      } catch { throw new ImportFailure('IMPORT_INVALID_OUTPUT') }
    }
  }))
}
export function mergeProfileParts(parts: Raw[]): ImportDraft {
  if (parts.length === 1) return parseImportDraft(JSON.stringify(parts[0]))
  const merged = { contact: parts[0].contact, links: parts[0].links, items: parts.flatMap(part => part.items), facts: parts.flatMap(part => part.facts) }
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
  const key = (fact: Raw['facts'][number]) => JSON.stringify([fact.kind, normalize(fact.content)])
  function unique(facts: Raw['facts']) {
    const seen = new Set<string>()
    return facts.filter(fact => { const id = key(fact); if (seen.has(id)) return false; seen.add(id); return true })
  }
  // Parent identity is significant: identical statements in different entries remain separate facts.
  for (const item of merged.items) item.facts = unique(item.facts)
  const attached = new Set(merged.items.flatMap(item => item.facts.map(key)))
  merged.facts = unique(merged.facts).filter(fact => !attached.has(key(fact)))
  return parseImportDraft(JSON.stringify(merged))
}
