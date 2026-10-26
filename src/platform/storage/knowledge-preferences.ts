import { object } from './validation'
import { fail } from '../../domain/common/errors'
import { defaultKnowledgePreferences, type KnowledgePreferences } from '../../shared/knowledge-settings'
export function knowledgePreferences(input: unknown, migrate = false): KnowledgePreferences {
  const value = { ...object(input, [...Object.keys(defaultKnowledgePreferences), ...(migrate ? ['providerId', 'modelId'] : [])]) }
  delete value.providerId
  delete value.modelId
  const p = { ...defaultKnowledgePreferences, ...value }
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
    p.branch.endsWith('/')
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
