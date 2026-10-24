import * as v from '../common/validation'
import { fail } from '../common/errors'
import { contact } from '../candidate/candidate.validation'
import type { GenerationRun, ResumeDocument } from './resume.types'
import { countWords, entryBasics, statements } from './document'

export const language = v.choice(['en', 'zh-CN'])
export const config = v.object({ templateId: v.optional(v.choice(['default-v1']), 'default-v1'), targetWordCount: v.optional(v.integer(100, 5000), 500),
  providerId: v.optionalText(100), modelId: v.optionalText(200), runtimeKind: v.optional(v.choice(['internal', 'external']), 'internal') })
const block = v.object({ id: v.id, text: v.text(20_000, 1), factIds: v.array(v.id, 1000) })
const writingEntry = v.object({ profileItemId: v.id, bullets: v.array(block, 100) })
export const writing = v.object({ summary: v.nullable(block), experience: v.array(writingEntry, 200), projects: v.array(writingEntry, 200), education: v.array(writingEntry, 200), skills: v.array(block, 200) })
const entry = v.object({ profileItemId: v.id, title: v.text(500, 1), organization: v.text(300), role: v.text(300), location: v.text(1000),
  startDate: v.text(10), endDate: v.text(10), isCurrent: v.boolean, degree: v.text(200), major: v.text(200), gpa: v.text(50), url: v.optionalUrl, bullets: v.array(block, 100) })
const version: v.Parser<1> = input => { if (input !== 1) fail('INVALID_INPUT'); return 1 }
export const content = v.object({ schemaVersion: version, language, basics: contact, summary: v.nullable(block), experience: v.array(entry, 200), projects: v.array(entry, 200), education: v.array(entry, 200), skills: v.array(block, 200) })
export const scores = v.array(v.object({ factId: v.id, score: v.integer(0, 100), reason: v.text(4000) }), 10000)
export const gate = v.object({ passed: v.boolean, reason: v.text(4000), missingRequirements: v.array(v.text(1000, 1)) })
export const selection = v.object({ factIds: v.array(v.id, 10000), itemIds: v.array(v.id, 1000), wordBudget: v.integer(100, 5000) })
const relativePath: v.Parser<string> = value => {
  const path = v.text(1000, 1)(value)
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('INVALID_INPUT')
  return path
}
export const outputFiles = v.array(v.object({ format: v.choice(['HTML', 'PDF']), relativePath }), 2)
export const outputState = v.object({ status: v.choice(['PENDING', 'RUNNING', 'READY', 'FAILED', 'CANCELLED']), error: v.nullable(v.text(100, 1)), pages: v.nullable(v.integer(1, 1000)) })

/** Structural provenance checks cannot establish the semantic truth of generated text. */
export function validateContent(run: GenerationRun, body: ResumeDocument, polishing = false): void {
  if (!run.selection || !run.language || body.language !== run.language) fail('CONFLICT')
  const { name, email, phone, location, links } = run.inputSnapshot.profile
  if (JSON.stringify(body.basics) !== JSON.stringify({ name, email, phone, location, links })) fail('CONFLICT')
  if (run.inputSnapshot.profile.introduction?.trim() && !body.summary) fail('CONFLICT')
  const selectedFacts = new Set(run.selection.factIds), selectedItems = new Set(run.selection.itemIds)
  const allBlocks = statements(body), itemIds: string[] = []
  for (const [group, type] of [[body.experience, 'EXPERIENCE'], [body.projects, 'PROJECT'], [body.education, 'EDUCATION']] as const) {
    for (const entry of group) {
      itemIds.push(entry.profileItemId)
      const item = run.inputSnapshot.items.find(item => item.id === entry.profileItemId && item.type === type)
      const { bullets, ...basics } = entry
      if (!item || !selectedItems.has(item.id) || JSON.stringify(basics) !== JSON.stringify(entryBasics(item))) fail('CONFLICT')
      for (const bullet of bullets) if (bullet.factIds.some(id => run.inputSnapshot.facts.find(fact => fact.id === id)?.profileItemId !== item.id)) fail('CONFLICT')
    }
  }
  v.unique(itemIds); v.unique(allBlocks.map(block => block.id))
  if (!allBlocks.length || allBlocks.length > 1000) fail('CONFLICT')
  for (const block of allBlocks) {
    v.unique(block.factIds)
    if (!block.factIds.length || block.factIds.some(id => !selectedFacts.has(id))) fail('CONFLICT')
  }
  if (allBlocks.reduce((n, block) => n + countWords(block.text, body.language), 0) > run.selection.wordBudget) fail('CONFLICT')
  if (polishing) {
    if (!run.draft) fail('INVALID_STATE')
    const originals = new Map(statements(run.draft).map(block => [block.id, block]))
    for (const block of allBlocks) {
      const original = originals.get(block.id)
      if (!original || block.factIds.some(id => !original.factIds.includes(id))) fail('CONFLICT')
    }
    const originalItems = new Set([...run.draft.experience, ...run.draft.projects, ...run.draft.education].map(entry => entry.profileItemId))
    if (itemIds.some(id => !originalItems.has(id))) fail('CONFLICT')
  }
}
