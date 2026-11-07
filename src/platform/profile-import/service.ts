import { randomUUID } from 'node:crypto'
import * as v from '../../domain/common/validation'
import { fail } from '../../domain/common/errors'
import { applyImportInput } from '../../domain/candidate/import.validation'
import type { ApplyImport, ImportDraft, ImportOrder, ImportSaved } from '../../domain/candidate/import.types'
import type { Result } from '../../shared/ipc'
import type { AIChoice } from '../../shared/ai'
import type { AIService } from '../ai'
import type { ImportEvent } from '../electron/profile-import-contract'
import { extractPdf, ImportFailure, type PdfPage } from '../import/pdf'
import { importPrompt, parseImportDraft, comparePosition } from './draft'
import { requestImport, ImportRequestFailure } from '../import/request'

interface File { owner: number; bytes: Uint8Array }
interface Session {
  owner: number; fileId: string; taskId: string; controller: AbortController; choice: AIChoice
  pages?: PdfPage[]
  state: 'running' | 'ready' | 'failed' | 'cancelled'; draft?: ImportDraft; profileId?: string
  order?: ImportOrder
  itemIds: Record<string, string>; consumed: Set<string>; contacts: Set<string>
  receipts: Map<string, { input: string; result: ImportSaved }>
  emit: (event: ImportEvent) => void
}
interface Dependencies {
  ai: Pick<AIService, 'start' | 'cancel'>
  apply(input: ApplyImport, order: ImportOrder): Result<ImportSaved>
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
    session.controller.abort(); session.pages = undefined
    if (session.state === 'running') {
      session.state = 'cancelled'
      publish(sessionId, session, { sessionId, taskId: session.taskId, type: 'cancelled' })
    }
  }
  function discardOwner(owner: number) {
    for (const [id, session] of sessions) if (session.owner === owner) { stop(id, session); sessions.delete(id) }
    for (const [id, file] of files) if (file.owner === owner) files.delete(id)
  }
  async function run(sessionId: string, session: Session, bytes: Uint8Array) {
    const task = { sessionId, taskId: session.taskId }
    const emit = (event: ImportEvent) => publish(sessionId, session, event)
    try {
      if (!session.pages) {
        emit({ ...task, type: 'phase', phase: 'extracting' })
        const pages = await (deps.extract ?? extractPdf)(bytes, session.controller.signal, (page, pages) => emit({ ...task, type: 'phase', phase: 'extracting', page, pages }))
        if (session.controller.signal.aborted || sessions.get(sessionId) !== session) return
        session.pages = pages
      }
      emit({ ...task, type: 'phase', phase: 'parsing' })
      const response = await requestImport(deps.ai, session.owner, session.choice, importPrompt(session.pages), session.controller.signal)
      if (session.controller.signal.aborted || sessions.get(sessionId) !== session) return
      session.draft = parseImportDraft(response, session.pages)
      session.order = { items: session.draft.items.map(item => item.draftId),
        facts: [...session.draft.facts, ...session.draft.unmapped ?? []].sort((a, b) => comparePosition(a.source!, b.source!)).map(row => row.draftId) }
      session.state = 'ready'; session.pages = undefined
      emit({ ...task, type: 'ready', draft: session.draft })
    } catch (error) {
      if (session.state !== 'running') return
      session.state = 'failed'
      emit({ ...task, type: 'failed', retryable: Boolean(session.pages),
        error: error instanceof ImportFailure || error instanceof ImportRequestFailure ? error.code : 'AI_PROVIDER_FAILED' })
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
        choice: args.choice, state: 'running', itemIds: {}, consumed: new Set(), contacts: new Set(), receipts: new Map(), emit }
      sessions.set(sessionId, session)
      setImmediate(() => { if (sessions.has(sessionId)) void run(sessionId, session, file.bytes) })
      return { sessionId, taskId: session.taskId }
    },
    retry(owner: number, input: unknown) {
      const { sessionId } = v.object({ sessionId: v.id })(input), session = ownedSession(owner, sessionId)
      if (session.state !== 'failed' || !session.pages) fail('INVALID_STATE')
      const file = files.get(session.fileId)
      if (!file) throw new ImportFailure('IMPORT_NOT_FOUND')
      session.state = 'running'; session.controller = new AbortController(); session.taskId = randomUUID()
      setImmediate(() => { if (sessions.get(sessionId) === session) void run(sessionId, session, file.bytes) })
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
      const args = applyImportInput(input), session = ownedSession(owner, args.sessionId), encoded = JSON.stringify(args)
      const receipt = session.receipts.get(args.batchId)
      if (receipt) { if (receipt.input !== encoded) fail('CONFLICT'); return { ok: true, value: structuredClone(receipt.result) } }
      if (session.state !== 'ready' || !session.draft) fail('INVALID_STATE')
      if (session.profileId && session.profileId !== args.profileId) fail('CONFLICT')
      const draft = session.draft
      for (const [key, value] of Object.entries(args.contact)) if (value !== undefined && session.contacts.has(key)) fail('CONFLICT')
      for (const [entries, allowed] of [[args.items, draft.items], [args.facts, [...draft.facts, ...draft.unmapped ?? []]], [args.links, draft.links]] as const) {
        for (const entry of entries) if (session.consumed.has(entry.draftId) || !allowed.some(known => known.draftId === entry.draftId)) fail('CONFLICT')
      }
      const facts = args.facts.map(fact => {
        if (fact.profileItemId) fail('CONFLICT') // Existing references come only from this session's saved mapping.
        if (fact.itemDraftId && session.itemIds[fact.itemDraftId]) return { ...fact, itemDraftId: null, profileItemId: session.itemIds[fact.itemDraftId] }
        return fact
      })
      const result = deps.apply({ ...args, facts }, session.order!)
      if (result.ok) {
        session.order!.base = result.value.orderBase
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
