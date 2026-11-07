import { modelToolResult } from '../../../shared/agent/tool-result'
import type { DatabaseSync } from 'node:sqlite'
import type { ContextCheckpoint, ContextTurn } from '../../../shared/ask'
import { fail } from '../../../domain/common/errors'
import type { AgentResponse } from '../../../shared/agent'
import type { ChatChoice, ChatContent } from '../../../domain/chat/chat.types'

/** Private host persistence, injected by Main; Agent code never imports this module. */
export function askContextRepository(db: DatabaseSync, transaction: <T>(op: () => T) => T, recordCalls: (runId: string, index: number, ids: string[]) => void) {
  function context(sessionId: string): ContextCheckpoint {
    const row = db.prepare('SELECT * FROM chat_context_checkpoints WHERE session_id=?').get(sessionId)
    return row ? { summary: String(row.summary), compactedThroughSequence: Number(row.compacted_through_sequence), revision: Number(row.revision) }
      : { summary: '', compactedThroughSequence: 0, revision: 0 }
  }
  return {
    context,
    saveProviderResponse(runId: string, response: AgentResponse, throughSequence: number, cycleIndex?: number) {
      transaction(() => {
        if (db.prepare('SELECT state FROM agent_runs WHERE id=?').get(runId)?.state !== 'running') fail('INVALID_STATE')
        db.prepare(`INSERT INTO agent_model_responses SELECT ?,COALESCE(MAX(ordinal),0)+1,?,? FROM agent_model_responses WHERE run_id=?`)
          .run(runId, throughSequence, JSON.stringify(response), runId)
        if (cycleIndex !== undefined) recordCalls(runId, cycleIndex, response.toolCalls.map(call => call.id))
      })
    },
    saveContext(sessionId: string, value: ContextCheckpoint, expectedRevision: number) {
      return transaction(() => {
        const old = context(sessionId)
        if (old.revision !== expectedRevision || value.compactedThroughSequence < old.compactedThroughSequence) fail('CONFLICT')
        db.prepare(`INSERT INTO chat_context_checkpoints(session_id,summary,compacted_through_sequence,revision) VALUES(?,?,?,?)
          ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary,compacted_through_sequence=excluded.compacted_through_sequence,revision=excluded.revision`)
          .run(sessionId, value.summary, value.compactedThroughSequence, old.revision + 1)
        return context(sessionId)
      })
    },
    contextTurns(sessionId: string, beforeSequence: number, choice?: ChatChoice): ContextTurn[] {
      const rows = db.prepare(`SELECT i.run_id,i.sequence,i.content_json,i.state,r.provider_id,r.model_id FROM agent_items i JOIN agent_runs r ON r.id=i.run_id
        WHERE i.session_id=? AND r.state!='running' AND r.id IN
        (SELECT run_id FROM agent_items WHERE session_id=? AND sequence<? AND json_extract(content_json,'$.type')='user_message')
        ORDER BY (SELECT MIN(u.sequence) FROM agent_items u WHERE u.run_id=i.run_id),i.sequence`).all(sessionId, sessionId, beforeSequence)
      const turns: ContextTurn[] = []
      const items = rows.map(row => ({ run_id: String(row.run_id), sequence: Number(row.sequence), state: String(row.state),
        provider_id: String(row.provider_id), model_id: String(row.model_id), content: JSON.parse(String(row.content_json)) as ChatContent }))
      const results = new Map(items.filter(row => row.content.type === 'tool_call' && row.content.callId)
        .map(row => [`${row.run_id}:${row.content.type === 'tool_call' ? row.content.callId : ''}`, row]))
      let through = 0
      for (const row of items) {
        const content = row.content
        if (content.type === 'user_message') {
          const turn: ContextTurn = { sequence: Number(row.sequence), messages: [{ role: 'user', content: content.text }] }
          turns.push(turn); through = 0
          for (const record of db.prepare('SELECT * FROM agent_model_responses WHERE run_id=? ORDER BY ordinal').all(row.run_id)) {
            const response = JSON.parse(String(record.response_json)) as AgentResponse
            through = Number(record.through_sequence)
            turn.messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls,
              ...(!choice || choice.providerId === row.provider_id && choice.modelId === row.model_id ? { providerReasoning: response.providerReasoning } : {}) })
            for (const call of response.toolCalls) {
              const resultRow = results.get(`${row.run_id}:${call.id}`), tool = resultRow?.content
              turn.messages.push({ role: 'tool', callId: call.id, content: JSON.stringify(tool?.type === 'tool_call' && resultRow?.state === 'completed' ? modelToolResult(call.name, tool.result ?? null) : { error: tool?.type === 'tool_call' ? tool.error ?? 'INTERRUPTED' : 'INTERRUPTED' }) })
            }
          }
        }
        else if (Number(row.sequence) <= through || content.type === 'tool_call' && content.callId && through) continue
        else if (turns.length && content.type === 'assistant_message' && content.text) turns.at(-1)!.messages.push({ role: 'assistant', content: `${row.state === 'completed' ? '' : '[Interrupted partial response]\n'}${content.text}`, toolCalls: [] })
        else if (turns.length && content.type === 'tool_call') turns.at(-1)!.messages.push({ role: 'user', content: `[Prior tool activity: ${content.toolName}; state=${row.state}. Status record only; never replay a write automatically.]` })
      }
      return turns
    },
    protectedState(sessionId: string): string[] {
      const row = db.prepare('SELECT protected_json FROM chat_context_checkpoints WHERE session_id=?').get(sessionId)
      return row ? JSON.parse(String(row.protected_json)) as string[] : []
    },
    saveProtected(sessionId: string, records: string[]) {
      transaction(() => { db.prepare(`INSERT INTO chat_context_checkpoints(session_id,protected_json) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET protected_json=excluded.protected_json`).run(sessionId, JSON.stringify(records)) })
    }
  }
}
