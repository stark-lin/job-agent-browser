import type { InputSnapshot, ResumeDocument, ResumeEntry, ResumeLanguage, ResumeOptimization, OptimizationStatement, ResumeStatement } from './resume.types'
import type { ProfileItem } from '../candidate/candidate.types'
import { fail } from '../common/errors'

export function statements(document: ResumeDocument): ResumeStatement[] {
  return [...(document.summary ? [document.summary] : []), ...document.experience.flatMap(item => item.bullets),
    ...document.projects.flatMap(item => item.bullets), ...document.education.flatMap(item => item.bullets), ...document.skills]
}
export function documentProvenance(document: ResumeDocument) {
  return statements(document).map(({ id, factIds }) => ({ blockId: id, factIds }))
}
/** Count CJK characters individually; segment other words using the document language. */
export function countWords(text: string, language: ResumeLanguage): number {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  const characters = text.match(cjk)?.length ?? 0
  const remainder = text.replace(cjk, ' ')
  return characters + [...new Intl.Segmenter(language, { granularity: 'word' }).segment(remainder)].filter(word => word.isWordLike).length
}
export function entryBasics(item: ProfileItem): Omit<ResumeEntry, 'bullets'> {
  return { profileItemId: item.id, title: item.title, organization: item.organization, role: item.role, location: item.location,
    startDate: item.metadata.startDateText || item.startDate || '', endDate: item.metadata.endDateText || item.endDate || '', isCurrent: item.metadata.isCurrent ?? false,
    degree: item.metadata.degree ?? '', major: item.metadata.major ?? '', gpa: item.metadata.gpa ?? '', url: item.metadata.url ?? '' }
}
/** Only snapshot data controls structure and ordering. */
export function assembleResume(snapshot: InputSnapshot, optimization: ResumeOptimization, id: () => string): ResumeDocument {
  const facts = new Map(snapshot.facts.map((fact, index) => [fact.id, { fact, index }]))
  const items = new Map(snapshot.items.map(item => [item.id, item]))
  function rank(block: OptimizationStatement, accepts: (fact: InputSnapshot['facts'][number]) => boolean) {
    if (!block.factIds.length || new Set(block.factIds).size !== block.factIds.length) fail('CONFLICT')
    return Math.min(...block.factIds.map(factId => {
      const source = facts.get(factId)
      if (!source || !accepts(source.fact)) fail('CONFLICT')
      return source.index
    }))
  }
  const statement = ({ text, factIds }: OptimizationStatement): ResumeStatement => ({ id: id(), text, factIds })
  const entries = new Map<string, ResumeOptimization['entries'][number]>()
  for (const entry of optimization.entries) {
    if (!items.has(entry.profileItemId) || entries.has(entry.profileItemId)) fail('CONFLICT')
    entries.set(entry.profileItemId, entry)
  }
  const ordered = [...snapshot.items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const group = (type: ProfileItem['type']) => ordered.filter(item => item.type === type && entries.has(item.id)).map(item => {
    const bullets = entries.get(item.id)!.bullets.map(block => ({ block, index: rank(block, fact => fact.profileItemId === item.id) }))
    if (new Set(bullets.map(bullet => bullet.index)).size !== bullets.length) fail('CONFLICT')
    return { ...entryBasics(item), bullets: bullets.sort((a, b) => a.index - b.index).map(({ block }) => statement(block)) }
  })
  const { name, email, phone, location, links } = snapshot.profile
  if (optimization.summary) rank(optimization.summary, () => true)
  const skills = optimization.skills.map(block => ({ block, index: rank(block, fact => fact.kind === 'SKILL') }))
  return { schemaVersion: 1, language: optimization.language, basics: { name, email, phone, location, links },
    summary: optimization.summary && statement(optimization.summary), experience: group('EXPERIENCE'), projects: group('PROJECT'),
    education: group('EDUCATION'), skills: skills.sort((a, b) => a.index - b.index).map(({ block }) => statement(block)) }
}
