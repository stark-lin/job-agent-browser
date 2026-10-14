import { fail } from '../../domain/common/errors'
import type { AIInput, AIMessage } from '../../shared/ai'
import { object } from '../storage/validation'
import { modelId, providerId } from '../storage/ai-preferences'

export function chatInput(input: unknown): AIInput {
  const value = object(input, ['choice', 'messages']), choice = object(value.choice, ['providerId', 'modelId'])
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100) return fail('INVALID_INPUT')
  let length = 0
  const messages = value.messages.map((entry): AIMessage => {
    const message = object(entry, ['role', 'content'])
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || !message.content.trim()) return fail('INVALID_INPUT')
    length += message.content.length
    return { role: message.role, content: message.content }
  })
  if (length > 128000 || messages[messages.length - 1].role !== 'user') return fail('INVALID_INPUT')
  return { choice: { providerId: providerId(choice.providerId), modelId: modelId(choice.modelId) }, messages }
}
