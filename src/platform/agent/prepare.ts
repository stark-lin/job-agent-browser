import { AgentError, type PreparationResult } from '../../shared/agent'

export function parsePreparation(text: string): PreparationResult {
  const trimmed = text.trim()
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  let value: unknown
  try {
    value = JSON.parse(fence ? fence[1] : trimmed)
  } catch {
    throw new AgentError('AGENT_PROTOCOL_ERROR')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('status' in value)) {
    throw new AgentError('AGENT_PROTOCOL_ERROR')
  }
  if (value.status === 'ready' && 'prompt' in value && typeof value.prompt === 'string' && value.prompt.trim()) {
    return { status: 'ready', prompt: value.prompt.trim() }
  }
  if (value.status === 'blocked' && 'reason' in value && typeof value.reason === 'string' && value.reason.trim()) {
    return { status: 'blocked', reason: value.reason.trim() }
  }
  throw new AgentError('AGENT_PROTOCOL_ERROR')
}
