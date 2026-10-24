import * as v from '../common/validation'
import type { ChatChoice } from './chat.types'
import type { ChatRepository } from './chat.repository'
import { chatChoice } from './chat.validation'

export function createChatService(repo: ChatRepository, validateChoice: (choice: ChatChoice) => void = () => {}) {
  return {
    listSessions(input: unknown) { const p = v.page(input); return repo.listSessions(p.limit, p.offset) },
    getRun(input: unknown) { return repo.getRun(v.byId(input).id) },
    getSession(input: unknown) { return repo.getSession(v.byId(input).id) },
    listItems(input: unknown) {
      const p = v.object({ sessionId: v.id, limit: v.optional(v.integer(1, 100), 50), beforeSequence: v.optional(v.integer(1, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER) })(input)
      repo.getSession(p.sessionId); return repo.listItems(p.sessionId, p.limit, p.beforeSequence)
    },
    listRuns(input: unknown) { const p = v.object({ sessionId: v.id, ...v.pageFields })(input); repo.getSession(p.sessionId); return repo.listRuns(p.sessionId, p.limit, p.offset) },
    renameSession(input: unknown) { const p = v.object({ id: v.id, title: v.text(120, 1) })(input); return repo.renameSession(p.id, p.title.trim()) },
    setModel(input: unknown) { const p = v.object({ id: v.id, choice: chatChoice })(input); validateChoice(p.choice); return repo.setModel(p.id, p.choice) },
    deleteSession(input: unknown) { return repo.deleteSession(v.byId(input).id) }
  }
}
