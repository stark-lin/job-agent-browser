import type { InputSnapshot, ResumeDocument, ResumeEntry, ResumeLanguage, ResumeStatement } from './resume.types'
import type { ProfileItem } from '../candidate/candidate.types'

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
export const bulletSections = ['experience', 'projects', 'education'] as const

/** Snapshot order and original text define the baseline. Only Facts contribute Fact IDs. */
export function createResumeFromProfile(snapshot: InputSnapshot, createId: () => string): ResumeDocument {
  const { name, email, phone, location, links, introduction } = snapshot.profile
  const statement = (text: string, factId?: string): ResumeStatement => ({ id: createId(), text, factIds: factId ? [factId] : [] })
  const items = [...snapshot.items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const group = (type: ProfileItem['type']) => items.filter(item => item.type === type).map(item => {
    const facts = snapshot.facts.filter(fact => fact.profileItemId === item.id && fact.content.trim())
    const hasSummary = item.summary.trim() && !facts.some(fact => fact.content === item.summary)
    return { ...entryBasics(item), bullets: [...(hasSummary ? [statement(item.summary)] : []),
      ...facts.map(fact => statement(fact.content, fact.id))] }
  })
  const body = [introduction, ...items.map(item => item.summary), ...snapshot.facts.map(fact => fact.content)].join(' ')
  const han = body.match(/\p{Script=Han}/gu)?.length ?? 0
  const latin = body.match(/\p{Script=Latin}/gu)?.length ?? 0
  return { schemaVersion: 1, language: han > 0 && han >= latin / 4 ? 'zh-CN' : 'en', basics: { name, email, phone, location, links: structuredClone(links) },
    summary: introduction?.trim() ? statement(introduction) : null,
    experience: group('EXPERIENCE'), projects: group('PROJECT'), education: group('EDUCATION'),
    skills: snapshot.facts.filter(fact => !fact.profileItemId && fact.kind === 'SKILL' && fact.content.trim()).map(fact => statement(fact.content, fact.id)) }
}
