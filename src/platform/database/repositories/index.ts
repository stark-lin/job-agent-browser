import type { Store } from './store'
import { jobRepository } from './jobs'
import { candidateRepository } from './candidates'
import { applicationRepository } from './applications'
import { resumeRepository } from './resumes'
import type { RuntimeLease } from '../runtime-leases'

export function repositories(store: Store, lease: RuntimeLease) {
  return { jobs: jobRepository(store), candidate: candidateRepository(store), applications: applicationRepository(store), resumes: resumeRepository(store, lease) }
}
