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

/** Main composition root. All services share one connection; generation has a separate trusted identity. */
export function composeBackend(database: ReturnType<typeof openDatabase>, storage: Pick<ServiceContract, 'settings' | 'secrets'> = storageScaffold) {
  const store = new Store(database.connection, database.transactions), repo = repositories(store)
  const user = database.transactions.forActor('USER'), system = database.transactions.forActor('SYSTEM')
  const runtime = { id: randomUUID, now: () => new Date().toISOString() }
  const services = {
    jobs: createJobService(repo.jobs, user, runtime), profiles: createCandidateService(repo.candidate, user, runtime),
    applications: createApplicationService(repo.jobs, repo.applications, user, runtime),
    resumes: createResumeService(repo.jobs, repo.candidate, repo.resumes, user, runtime, references(store)),
    audit: auditReader(store, user), ...storage
  } satisfies ServiceContract
  const generation = createGenerationService(repo.resumes, database.transactions.forActor('AI'), runtime)
  createGenerationService(repo.resumes, system, runtime).recoverInterrupted()
  const capabilities = createAuditedCapabilities(database.transactions.capabilities.sink)
  return {
    generation,
    capabilities,
    toolAudit: database.transactions.capabilities,
    toolCapabilities: createNativeCapabilities(services, capabilities),
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
    close: database.close
  }
}

export function createBackend(path: string, storage?: Pick<ServiceContract, 'settings' | 'secrets'>) {
  const database = openDatabase(path)
  try { return composeBackend(database, storage) } catch (error) { database.close(); throw error }
}
