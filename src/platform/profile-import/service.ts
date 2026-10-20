import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import { confirmedImport } from '../../domain/candidate/import.validation'
import type { ConfirmedImport, ImportDraft, ImportSaved } from '../../domain/candidate/import.types'
import type { Result } from '../../shared/ipc'
import type { AIChoice } from '../../shared/ai'
import type { AIService } from '../ai'
import type { ImportEvent } from '../electron/profile-import-contract'
import { extractPdf, ImportFailure, type PdfPage } from './pdf'
import { importPrompt, parseImportDraft } from './draft'

interface File { owner: number; bytes: Uint8Array }
interface Session {
  owner: number; fileId: string; taskId: string; controller: AbortController; aiId?: string
  state: 'running' | 'ready' | 'failed' | 'cancelled'; draft?: ImportDraft; profileId?: string
  itemIds: Record<string, string>; consumed: Set<string>; contacts: Set<string>
  receipts: Map<string, { input: string; result: ImportSaved }>
  emit: (event: ImportEvent) => void
}
interface Dependencies {
  ai: Pick<AIService, 'start' | 'cancel'>
  apply(input: ConfirmedImport): Result<ImportSaved>
  extract?: (bytes: Uint8Array, signal: AbortSignal, progress: (page: number, pages: number) => void) => Promise<PdfPage[]>
}
const choice = v.object({ providerId: v.text(100, 1), modelId: v.text(200, 1) })

/** Ephemeral session receipts distinguish retrying a save from importing another PDF. */
export function createProfileImporter(deps: Dependencies) {
  const files = new Map<string, File>(), sessions = new Map<string, Session>()
  const ownedSession = (owner: number, sessionId: string) => {
    const session = sessions.get(v.id(sessionId))
    if (!session) throw new ImportFailure('IMPORT_NOT_FOUND')
    if (session.owner !== owner) fail('FORBIDDEN')
    return session
  }
  function publish(sessionId: string, session: Session, event: ImportEvent) {
    if (sessions.get(sessionId) === session) { try { session.emit(event) } catch { stop(sessionId, session) } }
  }
  function stop(sessionId: string, session: Session) {
    session.controller.abort()
    if (session.aiId) deps.ai.cancel(session.owner, session.aiId)
    if (session.state === 'running') {
      session.state = 'cancelled'
      publish(sessionId, session, { sessionId, taskId: session.taskId, type: 'cancelled' })
    }
  }
  function discardOwner(owner: number) {
    for (const [id, session] of sessions) if (session.owner === owner) { stop(id, session); sessions.delete(id) }
    for (const [id, file] of files) if (file.owner === owner) files.delete(id)
  }
  async function run(sessionId: string, session: Session, bytes: Uint8Array, selected: AIChoice) {
    const task = { sessionId, taskId: session.taskId }
    const emit = (event: ImportEvent) => publish(sessionId, session, event)
    try {
      emit({ ...task, type: 'phase', phase: 'extracting' })
      const pages = await (deps.extract ?? extractPdf)(bytes, session.controller.signal, (page, pages) => emit({ ...task, type: 'phase', phase: 'extracting', page, pages }))
      if (session.controller.signal.aborted || sessions.get(sessionId) !== session) return
      emit({ ...task, type: 'phase', phase: 'parsing' })
      let output = ''
      session.aiId = deps.ai.start(session.owner, { choice: selected, messages: [{ role: 'user', content: importPrompt(pages) }] }, event => {
        if (session.state !== 'running' || session.controller.signal.aborted || sessions.get(sessionId) !== session) return
        if (event.type === 'delta') output += event.text
        else if (event.type === 'completed') {
          try {
            session.draft = parseImportDraft(output, pages); session.state = 'ready'
            emit({ ...task, type: 'ready', draft: session.draft })
          } catch { session.state = 'failed'; emit({ ...task, type: 'failed', error: 'IMPORT_INVALID_OUTPUT' }) }
          output = ''; pages.length = 0
        } else if (event.type === 'failed' || event.type === 'cancelled') {
          session.state = event.type === 'cancelled' ? 'cancelled' : 'failed'; output = ''; pages.length = 0
          emit(event.type === 'cancelled' ? { ...task, type: 'cancelled' } : { ...task, type: 'failed', error: event.error })
        }
      }).requestId
    } catch (error) {
      if (session.state !== 'running') return
      session.state = 'failed'
      emit({ ...task, type: 'failed', error: error instanceof ImportFailure ? error.code : 'AI_PROVIDER_FAILED' })
    }
  }
  return {
    select(owner: number, bytes: Uint8Array) {
      if (bytes.length > 10 * 1024 * 1024) throw new ImportFailure('PDF_TOO_LARGE')
      discardOwner(owner)
      const fileId = randomUUID(); files.set(fileId, { owner, bytes })
      return { fileId, bytes: bytes.length }
    },
    start(owner: number, input: unknown, emit: (event: ImportEvent) => void) {
      const args = v.object({ fileId: v.id, choice })(input), file = files.get(args.fileId)
      if (!file) throw new ImportFailure('IMPORT_NOT_FOUND')
      if (file.owner !== owner) fail('FORBIDDEN')
      for (const [id, previous] of sessions) if (previous.fileId === args.fileId) {
        if (previous.state === 'running' || previous.state === 'ready') fail('INVALID_STATE')
        sessions.delete(id)
      }
      const sessionId = randomUUID(), session: Session = { owner, fileId: args.fileId, taskId: randomUUID(), controller: new AbortController(),
        state: 'running', itemIds: {}, consumed: new Set(), contacts: new Set(), receipts: new Map(), emit }
      sessions.set(sessionId, session)
      setImmediate(() => { if (sessions.has(sessionId)) void run(sessionId, session, file.bytes, args.choice) })
      return { sessionId, taskId: session.taskId }
    },
    cancel(owner: number, input: unknown) {
      const { sessionId } = v.object({ sessionId: v.id })(input), session = ownedSession(owner, sessionId)
      stop(sessionId, session)
    },
    discard(owner: number, input: unknown) {
      const args = v.object({ fileId: v.optionalId, sessionId: v.optionalId })(input)
      if (args.sessionId) {
        const session = ownedSession(owner, args.sessionId); stop(args.sessionId, session)
        sessions.delete(args.sessionId); files.delete(session.fileId)
      }
      if (args.fileId) {
        const file = files.get(args.fileId)
        if (file && file.owner !== owner) fail('FORBIDDEN')
        for (const [id, session] of sessions) if (session.fileId === args.fileId) { stop(id, session); sessions.delete(id) }
        files.delete(args.fileId)
      }
    },
    apply(owner: number, input: unknown): Result<ImportSaved> {
      const args = confirmedImport(input), session = ownedSession(owner, args.sessionId), encoded = JSON.stringify(args)
      const receipt = session.receipts.get(args.batchId)
      if (receipt) { if (receipt.input !== encoded) fail('CONFLICT'); return { ok: true, value: structuredClone(receipt.result) } }
      if (session.state !== 'ready' || !session.draft) fail('INVALID_STATE')
      if (session.profileId && session.profileId !== args.profileId) fail('CONFLICT')
      const draft = session.draft
      for (const [key, value] of Object.entries(args.contact)) if (value !== undefined && session.contacts.has(key)) fail('CONFLICT')
      for (const [entries, allowed] of [[args.items, draft.items], [args.facts, draft.facts], [args.links, draft.links]] as const) {
        for (const entry of entries) if (session.consumed.has(entry.draftId) || !allowed.some(known => known.draftId === entry.draftId)) fail('CONFLICT')
      }
      const facts = args.facts.map(fact => {
        if (fact.profileItemId) fail('CONFLICT') // Existing references come only from this session's saved mapping.
        if (fact.itemDraftId && session.itemIds[fact.itemDraftId]) return { ...fact, itemDraftId: null, profileItemId: session.itemIds[fact.itemDraftId] }
        return fact
      })
      const result = deps.apply({ ...args, facts })
      if (result.ok) {
        session.profileId = result.value.profile.id
        Object.assign(session.itemIds, result.value.itemIds)
        for (const entry of [...args.items, ...args.facts, ...args.links]) session.consumed.add(entry.draftId)
        for (const [key, value] of Object.entries(args.contact)) if (value !== undefined) session.contacts.add(key)
        session.receipts.set(args.batchId, { input: encoded, result: structuredClone(result.value) })
      }
      return result
    },
    disposeOwner: discardOwner,
    dispose() { for (const owner of new Set([...files.values()].map(file => file.owner))) discardOwner(owner) }
  }
}
export type ProfileImporter = ReturnType<typeof createProfileImporter>
