import { object } from './validation'
import { fail } from '../../domain/common/errors'
import { defaultKnowledgePreferences, type KnowledgePreferences } from '../../shared/knowledge-settings'
export function knowledgePreferences(input: unknown): KnowledgePreferences {
  const value = object(input, Object.keys(defaultKnowledgePreferences)),
    p = { ...defaultKnowledgePreferences, ...value }
  if (
    !['edit', 'split', 'preview'].includes(p.mode) ||
    !Number.isInteger(p.explorerWidth) ||
    p.explorerWidth < 192 ||
    p.explorerWidth > 480 ||
    typeof p.semanticEnabled !== 'boolean' ||
    typeof p.remote !== 'string' ||
    p.remote.length > 2048 ||
    typeof p.branch !== 'string' ||
    !/^[-\w][\w/-]{0,100}$/.test(p.branch) ||
    p.branch.includes('..') ||
    p.branch.includes('//') ||
    p.branch.endsWith('/') ||
    typeof p.providerId !== 'string' ||
    p.providerId.length > 100 ||
    typeof p.modelId !== 'string' ||
    p.modelId.length > 200 ||
    (p.semanticEnabled && (!p.providerId || !p.modelId))
  )
    fail('INVALID_INPUT')
  if (p.remote) {
    let url: URL
    try {
      url = new URL(p.remote)
    } catch {
      return fail('INVALID_INPUT')
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname)
    )
      fail('INVALID_INPUT')
  }
  return p
}
