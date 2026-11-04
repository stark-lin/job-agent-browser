import * as v from '../common/validation'
import { fail } from '../common/errors'
import type { ChatDebugOutput, ChatDebugRepository } from './chat-debug.types'

/** Host-owned, read-only copy use case; output formatting belongs to the host adapter. */
export function createChatDebugService(repo: ChatDebugRepository, output?: ChatDebugOutput) {
  return {
    async copyDebugJson(input: unknown): Promise<null> {
      const { sessionId } = v.object({ sessionId: v.id })(input)
      if (!output) fail('NOT_IMPLEMENTED')
      return output.copy(repo.getDebugBundle(sessionId))
    }
  }
}
