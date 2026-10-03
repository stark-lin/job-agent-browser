import * as v from '../common/validation'
import { fail } from '../common/errors'
import { contact } from '../candidate/candidate.validation'
import type { GenerationRun, Provenance, ResumeContent } from './resume.types'

export const config = v.object({ templateId: v.optional(v.text(100, 1), 'default'), targetWordCount: v.optional(v.integer(100, 5000), 500) })
const block = v.object({ id: v.id, text: v.text(20_000, 1) })
const contentItem = v.object({ id: v.id, profileItemId: v.optionalId, title: v.text(500, 1), subtitle: v.optionalText(1000), dateRange: v.optionalText(100), blocks: v.array(block, 100) })
const version: v.Parser<1> = (input) => { if (input !== 1) fail('INVALID_INPUT'); return 1 }
export const content = v.object({ schemaVersion: version, header: contact, summary: v.nullable(block), sections: v.array(v.object({ id: v.id, title: v.text(500, 1), items: v.array(contentItem, 100) }), 30) })
export const provenance = v.array(v.object({ blockId: v.id, factIds: v.array(v.id, 200) }), 1000)
export const scores = v.array(v.object({ factId: v.id, score: v.integer(0, 100), reason: v.text(4000) }))
export const gate = v.object({ passed: v.boolean, reason: v.text(4000), missingRequirements: v.array(v.text(1000, 1)) })
export const selection = v.object({ factIds: v.array(v.id), itemIds: v.array(v.id), wordBudget: v.integer(100, 5000) })
const relativePath: v.Parser<string> = (value) => {
  const path = v.text(1000, 1)(value)
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) fail('INVALID_INPUT')
  return path
}
export const outputFiles = v.array(v.object({ format: v.choice(['PDF', 'DOCX']), relativePath }), 2)

export function validateContent(run: GenerationRun, body: ResumeContent, links?: Provenance[]): void {
  const items = new Set(run.inputSnapshot.items.map((item) => item.id))
  const selectedFacts = new Set(run.selection?.factIds ?? [])
  const selectedItems = new Set(run.selection?.itemIds ?? [])
  const ids: string[] = [], blocks = body.summary ? [body.summary] : []
  for (const section of body.sections) {
    ids.push(section.id)
    for (const item of section.items) {
      ids.push(item.id)
      if (item.profileItemId && (!items.has(item.profileItemId) || !selectedItems.has(item.profileItemId))) fail('CONFLICT')
      blocks.push(...item.blocks)
    }
  }
  ids.push(...blocks.map((entry) => entry.id))
  v.unique(ids)
  if (blocks.length === 0) fail('CONFLICT')
  if (blocks.length > 1000) fail('INVALID_INPUT')
  if (!links) return
  v.unique(links.map((link) => link.blockId))
  const blockIds = new Set(blocks.map((entry) => entry.id))
  for (const link of links) {
    if (!blockIds.has(link.blockId) || link.factIds.length === 0) fail('CONFLICT')
    v.unique(link.factIds)
    if (link.factIds.some((id) => !selectedFacts.has(id))) fail('CONFLICT')
  }
  // Every generated text block must be explainable using the immutable input snapshot.
  if (links.length !== blocks.length) fail('CONFLICT')
  const words = blocks.reduce((count, entry) => count + entry.text.trim().split(/\s+/u).length, 0)
  if (words > (run.selection?.wordBudget ?? run.config.targetWordCount)) fail('CONFLICT')
}
