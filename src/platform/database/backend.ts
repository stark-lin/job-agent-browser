import { randomUUID } from 'node:crypto'
import { createJobService } from '../../domain/job/job.service'
import { createCandidateService } from '../../domain/candidate/candidate.service'
import { createApplicationService } from '../../domain/application/application.service'
import { createResumeService } from '../../domain/resume/resume.service'
import { createGenerationService } from '../../domain/resume/generation.service'
import { errorCode } from '../../domain/common/errors'
import type { Result } from '../../shared/ipc'
import { methodNames, type ServiceContract } from '../electron/data-contract'
import { storageScaffold } from '../storage'
import { openDatabase } from './sqlite'
import { Store } from './repositories/store'
import { repositories } from './repositories'
import { auditReader, references } from './audit-reader'
import { createAuditedCapabilities } from '../tools/capabilities'
import { createNativeCapabilities } from '../tools/native'
import { createRuntimeLease } from './runtime-leases'

/** Shared runtime composition. All services share one connection; generation has a trusted runtime identity. */
export function composeBackend(database: ReturnType<typeof openDatabase>, storage: Pick<ServiceContract, 'settings' | 'secrets'> = storageScaffold, kind: 'internal' | 'external' = 'internal') {
  const lease = createRuntimeLease(database.connection, kind)
  database.transactions.capabilities.setRuntime(lease)
  const store = new Store(database.connection, database.transactions), repo = repositories(store, lease)
  const user = database.transactions.forActor('USER'), system = database.transactions.forActor('SYSTEM')
  const runtime = { id: randomUUID, now: () => new Date().toISOString() }
  const services = {
    jobs: createJobService(repo.jobs, user, runtime), profiles: createCandidateService(repo.candidate, user, runtime),
    applications: createApplicationService(repo.jobs, repo.applications, user, runtime),
    resumes: createResumeService(repo.jobs, repo.candidate, repo.resumes, kind === 'external' ? database.transactions.forActor('EXTERNAL') : user, runtime, references(store), kind),
    audit: auditReader(store, user), ...storage
  } satisfies ServiceContract
  const generation = createGenerationService(repo.resumes, database.transactions.forActor(kind === 'external' ? 'EXTERNAL' : 'AI'), runtime)
  function recover() {
    createGenerationService(repo.resumes, system, runtime).recoverInterrupted()
    const interrupted = database.connection.prepare("SELECT id FROM artifacts WHERE json_extract(output_json,'$.status')='RUNNING'").all()
    for (const row of interrupted) if (!lease.active('output', String(row.id))) {
      createGenerationService(repo.resumes, system, runtime).recordOutputState({ id: row.id, output: { status: 'FAILED', error: 'OUTPUT_INTERRUPTED', pages: null } })
    }
    database.transactions.capabilities.recoverInterrupted()
  }
  recover()
  const recovery = setInterval(() => { try { recover() } catch { /* Retry after transient contention; never reset storage. */ } }, 5000)
  recovery.unref()
  const capabilities = createAuditedCapabilities(database.transactions.capabilities.sink)
  return {
    generation,
    lease,
    recover,
    outputTransaction: system,
    resumes: services.resumes,
    ownedStart(requestId: string) {
      const row = database.connection.prepare('SELECT run_id FROM resume_start_receipts WHERE request_id=? AND runtime_id=?').get(requestId, lease.id)
      return row ? services.resumes.getRun({ id: String(row.run_id) }).run : null
    },
    artifactForRun: (id: string) => user.read(() => repo.resumes.artifactForRun(id)),
    capabilities,
    toolAudit: database.transactions.capabilities,
    toolCapabilities: createNativeCapabilities(services, capabilities),
    recordAgentModel: database.transactions.recordAgentModel.bind(database.transactions),
    recordAI: database.transactions.recordAI.bind(database.transactions),
    dispatch(namespace: unknown, method: unknown, input: unknown): Result<unknown> {
      if (typeof namespace !== 'string' || typeof method !== 'string' || !Object.hasOwn(methodNames, namespace)) return { ok: false, error: 'INVALID_INPUT' }
      const group = namespace as keyof typeof methodNames
      if (!(methodNames[group] as readonly string[]).includes(method)) return { ok: false, error: 'INVALID_INPUT' }
      try {
        // The registry permits business endpoints only, never property/prototype traversal.
        const endpoint = (services[group] as unknown as Record<string, (input: unknown) => unknown>)[method]
        return { ok: true, value: endpoint(input) }
      } catch (error) { return { ok: false, error: errorCode(error) } }
    },
    close() { clearInterval(recovery); lease.close(); database.close() }
  }
}

export function createBackend(path: string, storage?: Pick<ServiceContract, 'settings' | 'secrets'>, kind: 'internal' | 'external' = 'internal') {
  const database = openDatabase(path)
  try { return composeBackend(database, storage, kind) } catch (error) { database.close(); throw error }
}
