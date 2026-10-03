import type { Store } from './store'
import { jobRepository } from './jobs'
import { candidateRepository } from './candidates'
import { applicationRepository } from './applications'
import { resumeRepository } from './resumes'

export function repositories(store: Store) {
  return { jobs: jobRepository(store), candidate: candidateRepository(store), applications: applicationRepository(store), resumes: resumeRepository(store) }
}
