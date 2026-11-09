import { consola } from 'consola'
import { createChatDebugService } from '../../domain/chat/chat-debug.service'
import type { ChatDebugOutput } from '../../domain/chat/chat-debug.types'
import { chatDebugExportRepository } from './repositories/chat-debug-export'
import { chatRepository } from './repositories/chats'
import { createChatService } from '../../domain/chat/chat.service'
import { createHash, randomUUID } from 'node:crypto'
import { createJobService } from '../../domain/job/job.service'
import { createProfileWriteService } from '../../domain/candidate/write.service'
import { createCandidateService } from '../../domain/candidate/candidate.service'
import { createApplicationService } from '../../domain/application/application.service'
import { createResumeService } from '../../domain/resume/resume.service'
import { createGenerationService } from '../../domain/resume/generation.service'
import { errorCode, fail } from '../../domain/common/errors'
import type { Result } from '../../shared/ipc'
import { methodNames, type ServiceContract } from '../electron/data-contract'
import { storageScaffold } from '../storage'
import { openDatabase } from './sqlite'
import { Store } from './repositories/store'
import { repositories } from './repositories'
import { references } from './references'
import { createCapabilities } from '../tools/capabilities'
import { createNativeCapabilities } from '../tools/native'
import { operationReceipts } from './operation-receipts'
import { createRuntimeLease } from './runtime-leases'

type DispatchResult<G extends keyof ServiceContract, M extends keyof ServiceContract[G]> = ServiceContract[G][M] extends (input: never) => infer O
  ? O extends Promise<unknown> ? Promise<Result<Awaited<O>>> : Result<unknown> : never

export interface BackendHost { chatDebugOutput?: ChatDebugOutput }

/** Shared runtime composition. All services share one connection; generation has a trusted runtime identity. */
export function composeBackend(database: ReturnType<typeof openDatabase>, storage: Pick<ServiceContract, 'settings' | 'secrets'> = storageScaffold, kind: 'internal' | 'external' = 'internal', host: BackendHost = {}) {
  const lease = createRuntimeLease(database.connection, kind)
  const store = new Store(database.connection), repo = repositories(store, lease)
  const tx = database.transactions
  const receipts = operationReceipts(database.connection)
  const runtime = { id: randomUUID, now: () => new Date().toISOString() }
  const chats = chatRepository(database.connection, lease)
  const services = {
    chats: { ...createChatService(chats, choice => {
      if (!storage.settings.get({}).ai.providers.some(p => p.id === choice.providerId && p.models.includes(choice.modelId))) fail('AI_NOT_CONFIGURED')
    }), ...createChatDebugService(chatDebugExportRepository(database.connection), host.chatDebugOutput) },
    jobs: createJobService(repo.jobs, tx, runtime, receipts), profiles: createCandidateService(repo.candidate, tx, runtime),
    applications: createApplicationService(repo.jobs, repo.applications, tx, runtime, receipts),
    resumes: createResumeService(repo.jobs, repo.candidate, repo.resumes, tx, runtime, references(database.connection), kind),
    ...storage
  } satisfies ServiceContract
  const fingerprint = (input: string) => createHash('sha256').update(input).digest('hex')
  const generation = createGenerationService(repo.resumes, tx, runtime, fingerprint)
  const recoveryGeneration = createGenerationService(repo.resumes, tx, runtime, fingerprint)
  function recover() {
    chats.recover()
    recoveryGeneration.recoverInterrupted()
    const interrupted = database.connection.prepare("SELECT id FROM artifacts WHERE json_extract(output_json,'$.status')='RUNNING'").all()
    for (const row of interrupted) {
      const id = String(row.id)
      if (lease.active('output', id)) continue
      try {
        const current = tx.read(() => repo.resumes.getArtifact(id))
        if (current.output.status !== 'RUNNING') continue
        recoveryGeneration.commitOutput(id, current.revision,
          { status: 'FAILED', error: 'OUTPUT_INTERRUPTED', pages: null }, [], () => {
            lease.available('output', id)
            if (repo.resumes.getArtifact(id).output.status !== 'RUNNING') fail('CONFLICT')
          })
      } catch (error) { if (!['CONFLICT', 'NOT_FOUND'].includes(errorCode(error))) throw error }
    }
  }
  recover()
  const recovery = setInterval(() => { try { recover() } catch { /* Retry after transient contention; never reset storage. */ } }, 5000)
  recovery.unref()
  const capabilities = createCapabilities()
  function dispatch<G extends keyof ServiceContract, M extends keyof ServiceContract[G]>(namespace: G, method: M, input: unknown): DispatchResult<G, M>
  function dispatch(namespace: unknown, method: unknown, input: unknown): Result<unknown> | Promise<Result<unknown>>
  function dispatch(namespace: unknown, method: unknown, input: unknown): Result<unknown> | Promise<Result<unknown>> {
    if (typeof namespace !== 'string' || typeof method !== 'string' || !Object.hasOwn(methodNames, namespace)) return { ok: false, error: 'INVALID_INPUT' }
    const group = namespace as keyof typeof methodNames
    if (!(methodNames[group] as readonly string[]).includes(method)) return { ok: false, error: 'INVALID_INPUT' }
    const finish = (result: Result<unknown>) => {
      try {
        const message = `[DB] ${group}.${method} ${result.ok ? 'SUCCESS' : result.error}`
        if (result.ok) consola.success(message)
        else consola.warn(message)
      } catch { /* Diagnostics never change business outcomes. */ }
      return result
    }
    try {
      // The registry permits business endpoints only, never property/prototype traversal.
      const endpoint = (services[group] as unknown as Record<string, (input: unknown) => unknown>)[method]
      const value = endpoint(input)
      return value instanceof Promise ? value.then(value => finish({ ok: true, value })).catch(error => finish({ ok: false, error: errorCode(error) })) : finish({ ok: true, value })
    } catch (error) { return finish({ ok: false, error: errorCode(error) }) }
  }
  return {
    applyProfileImport(input: Parameters<typeof services.profiles.applyImport>[0], order: Parameters<typeof services.profiles.applyImport>[1]) {
      try { return { ok: true, value: services.profiles.confirmImport(input, order) } as const }
      catch (error) { return { ok: false, error: errorCode(error) } as const }
    },
    generation,
    profileWrites: createProfileWriteService(repo.candidate, tx, runtime, receipts),
    chats,
    lease,
    recover,
    outputTransaction: tx,
    artifactForOutput: (id: string) => repo.resumes.getArtifact(id),
    resumes: services.resumes,
    jobs: services.jobs,
    profiles: services.profiles,
    applications: services.applications,
    ownedStart(requestId: string) {
      const row = database.connection.prepare('SELECT run_id FROM resume_start_receipts WHERE request_id=? AND runtime_id=?').get(requestId, lease.id)
      return row ? services.resumes.getRun({ id: String(row.run_id) }).run : null
    },
    generationRun: (id: string) => tx.read(() => repo.resumes.getRun(id)),
    rewrittenBulletIds: (id: string) => tx.read(() => repo.resumes.rewrittenBulletIds(id)),
    artifactForRun: (id: string) => tx.read(() => repo.resumes.artifactForRun(id)),
    capabilities,
    toolCapabilities: createNativeCapabilities(services, capabilities),
    dispatch,
    close() { clearInterval(recovery); lease.close(); database.close() }
  }
}

export function createBackend(path: string, storage?: Pick<ServiceContract, 'settings' | 'secrets'>, kind: 'internal' | 'external' = 'internal', host: BackendHost = {}) {
  const database = openDatabase(path)
  try { return composeBackend(database, storage, kind, host) } catch (error) { database.close(); throw error }
}
