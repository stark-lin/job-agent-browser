import type { AIChoice, AISettings } from '../../shared/ai'
import type { ErrorCode } from '../../domain/common/errors'
import { requestConfig } from './transport'
import { compatibleAgentModel } from './agent-model'

export function createAgentModels(deps: { settings(): AISettings; key(id: string): string | null;
  audit(id: string, error: ErrorCode | null, agentId: string): void }) {
  return (agentId: string, choice: AIChoice | null = deps.settings().default) => compatibleAgentModel(requestConfig(deps.settings(), deps.key, choice), {
    audit: (id, error) => deps.audit(id, error, agentId)
  })
}
