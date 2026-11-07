import * as v from '../common/validation'
import { fail } from '../common/errors'
import { importContactLink } from '../candidate/candidate.validation'
import type { GenerationRun, ResumeDocument } from './resume.types'
import { statements } from './document'

export const language = v.choice(['en', 'zh-CN'])
export const config = v.object({ templateId: v.optional(v.choice(['default-v1']), 'default-v1'), targetWordCount: v.optional(v.integer(100, 5000), 500),
  providerId: v.optionalText(100), modelId: v.optionalText(200), runtimeKind: v.optional(v.choice(['internal', 'external']), 'internal') })
export const bulletText = v.text(20_000, 1)
const basicFields = { name: v.text(300), email: v.text(320), phone: v.text(100), location: v.text(1000), links: v.array(importContactLink, 20) }
const basics = v.object(basicFields)
const blockFields = { id: v.id, text: bulletText, factIds: v.array(v.id, 1000) }
const block = v.object(blockFields)
// Imported item titles may be empty.
const entryFields = { profileItemId: v.id, title: v.text(500), organization: v.text(300), role: v.text(300), location: v.text(1000),
  startDate: v.text(10), endDate: v.text(10), isCurrent: v.boolean, degree: v.text(200), major: v.text(200), gpa: v.text(50), url: v.optionalUrl, bullets: v.array(block, 100) }
const entry = v.object(entryFields)
const version: v.Parser<1> = input => { if (input !== 1) fail('INVALID_INPUT'); return 1 }
const contentFields = { schemaVersion: version, language, basics, summary: v.nullable(block), experience: v.array(entry, 200), projects: v.array(entry, 200), education: v.array(entry, 200), skills: v.array(block, 200) }
export const content = v.object(contentFields)
// Human-edited display text keeps its spelling and formatting through persistence and output.
const editedBlock = v.object({ ...blockFields, text: v.text(20_000) })
const editedEntry = v.object({ ...entryFields, startDate: v.text(200), endDate: v.text(200), url: v.optionalText(4096), bullets: v.array(editedBlock, 100) })
export const editedContent = v.object({ ...contentFields,
  basics: v.object({ ...basicFields, links: v.array(v.object({ label: v.optionalText(100), url: v.optionalText(4096) }), 20) }),
  summary: v.nullable(editedBlock), experience: v.array(editedEntry, 200), projects: v.array(editedEntry, 200),
  education: v.array(editedEntry, 200), skills: v.array(editedBlock, 200) })
const relativePath: v.Parser<string> = value => {
  const path = v.text(1000, 1)(value)
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('INVALID_INPUT')
  return path
}
export const outputFiles = v.array(v.object({ format: v.choice(['HTML', 'PDF']), relativePath }), 2)
export const outputState = v.object({ status: v.choice(['PENDING', 'RUNNING', 'READY', 'FAILED', 'CANCELLED']), error: v.nullable(v.text(100, 1)), pages: v.nullable(v.integer(1, 1000)) })

export function validateGeneratedResume(run: GenerationRun, document: ResumeDocument): void {
  content(document)
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 768_000) fail('INVALID_INPUT')
  const blocks = statements(document)
  if (run.inputSnapshot.profile.introduction?.trim() && !document.summary) fail('CONFLICT')
  if (!blocks.length || blocks.length > 1000) fail('CONFLICT')
  v.unique(blocks.map(block => block.id))
}

export function validateEditedResume(previous: ResumeDocument, next: ResumeDocument): ResumeDocument {
  if (next.language !== previous.language) fail('CONFLICT')
  v.unique(statements(next).map(block => block.id))
  if (statements(next).length > 1000) fail('INVALID_INPUT')
  const existingIds = new Set(statements(previous).map(block => block.id))
  function preserve(before: ResumeDocument['skills'], after: ResumeDocument['skills']) {
    const existing = new Map(before.map(block => [block.id, block]))
    for (const block of after) {
      const original = existing.get(block.id)
      if (!original && existingIds.has(block.id)) fail('CONFLICT')
      block.factIds = original?.text === block.text ? original.factIds : []
    }
  }
  for (const section of ['experience', 'projects', 'education'] as const) {
    if (next[section].length !== previous[section].length) fail('CONFLICT')
    next[section].forEach((entry, index) => {
      const original = previous[section][index]
      if (entry.profileItemId !== original.profileItemId) fail('CONFLICT')
      preserve(original.bullets, entry.bullets)
    })
  }
  preserve(previous.summary ? [previous.summary] : [], next.summary ? [next.summary] : [])
  preserve(previous.skills, next.skills)
  return next
}
