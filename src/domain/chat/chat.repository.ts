import type { ChatChoice, ChatItem, ChatPage, ChatRun, ChatSession } from './chat.types'

export interface ChatRepository {
  listSessions(limit: number, offset: number): ChatPage<ChatSession>
  getSession(id: string): ChatSession
  getRun(id: string): ChatRun
  renameSession(id: string, title: string): ChatSession
  setModel(id: string, choice: ChatChoice): ChatSession
  deleteSession(id: string): null
  listItems(sessionId: string, limit: number, before?: number): ChatPage<ChatItem>
  listRuns(sessionId: string, limit: number, offset: number): ChatPage<ChatRun>
}
