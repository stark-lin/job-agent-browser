import type { InputSnapshot, ResumeDocument, ResumeEntry, ResumeLanguage, ResumeStatement, ResumeWriting } from './resume.types'
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
export function materializeDocument(snapshot: InputSnapshot, language: ResumeLanguage, writing: ResumeWriting): ResumeDocument {
  const entries = (group: ResumeWriting['experience'], type: ProfileItem['type']) => group.map(entry => {
    const item = snapshot.items.find(item => item.id === entry.profileItemId && item.type === type)
    if (!item) fail('CONFLICT')
    return { ...entryBasics(item), bullets: structuredClone(entry.bullets) }
  })
  const { name, email, phone, location, links } = snapshot.profile
  return { schemaVersion: 1, language, basics: { name, email, phone, location, links: structuredClone(links) }, summary: structuredClone(writing.summary),
    experience: entries(writing.experience, 'EXPERIENCE'), projects: entries(writing.projects, 'PROJECT'), education: entries(writing.education, 'EDUCATION'), skills: structuredClone(writing.skills) }
}
export function writingOf(document: ResumeDocument): ResumeWriting {
  const group = (entries: ResumeEntry[]) => entries.map(({ profileItemId, bullets }) => ({ profileItemId, bullets }))
  return { summary: document.summary, experience: group(document.experience), projects: group(document.projects), education: group(document.education), skills: document.skills }
}
