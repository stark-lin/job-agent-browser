import type { AIChoice, AISettings } from '../../shared/ai'
import { requestConfig } from './transport'
import { compatibleAgentModel } from './agent-model'

export function createAgentModels(deps: { settings(): AISettings; key(id: string): string | null }) {
  return (choice: AIChoice | null = deps.settings().default) => compatibleAgentModel(requestConfig(deps.settings(), deps.key, choice))
}
