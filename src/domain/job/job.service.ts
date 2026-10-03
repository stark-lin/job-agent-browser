import type { JobRepository } from './job.repository'
import type { Runtime, UnitOfWork } from '../common/ports'
import { fail } from '../common/errors'
import * as v from '../common/validation'
import { companyDetails, jobDetails, jobFilter, sourceDetails } from './job.validation'
import type { Job, JobSource } from './job.types'

export function createJobService(repo: JobRepository, tx: UnitOfWork, runtime: Runtime) {
  const validateDetails = (input: unknown) => {
    const details = jobDetails(input)
    if (details.companyId) repo.getCompany(details.companyId)
    if (details.salary && details.salary.min !== null && details.salary.max !== null && details.salary.min > details.salary.max) fail('INVALID_INPUT')
    return details
  }
  const addSource = (jobId: string, input: unknown): JobSource => {
    const details = sourceDetails(input)
    const normalized = new URL(details.url)
    normalized.hash = ''
    normalized.searchParams.sort()
    const now = runtime.now()
    const source = { ...details, id: runtime.id(), jobId, normalizedUrl: normalized.href, fingerprint: '', firstSeenAt: now, lastSeenAt: now }
    repo.insertSource(source)
    return source
  }
  return {
    saveJob(input: unknown) {
      return tx.write({ event: 'JOB_SAVE', action: 'CREATE', target: 'job' }, () => {
        const args = v.object({ details: jobDetails, source: v.optional(v.nullable(sourceDetails), null) })(input)
        const now = runtime.now()
        const job: Job = { ...validateDetails(args.details), id: runtime.id(), applicationStatus: 'NOT_STARTED', savedAt: now, appliedAt: null, closedAt: null, archivedAt: null, createdAt: now, updatedAt: now }
        repo.insert(job)
        if (args.source) addSource(job.id, args.source)
        return job
      })
    },
    updateDetails(input: unknown) {
      return tx.write({ event: 'JOB_EDIT', action: 'UPDATE', target: 'job' }, () => {
        const { id, details } = v.object({ id: v.id, details: jobDetails })(input)
        const job = { ...repo.get(id), ...validateDetails(details), updatedAt: runtime.now() }
        repo.save(job)
        return job
      })
    },
    attachSource(input: unknown) {
      return tx.write({ event: 'JOB_SOURCE_ATTACH', action: 'CREATE', target: 'job_source' }, () => {
        const args = v.object({ jobId: v.id, source: sourceDetails })(input)
        repo.get(args.jobId)
        return addSource(args.jobId, args.source)
      })
    },
    setArchived(input: unknown) {
      return tx.write({ event: 'JOB_ARCHIVE', action: 'UPDATE', target: 'job' }, () => {
        const { id, archived } = v.object({ id: v.id, archived: v.boolean })(input)
        const job = repo.get(id)
        job.archivedAt = archived ? runtime.now() : null
        job.updatedAt = runtime.now()
        repo.save(job)
        return job
      })
    },
    deleteJob(input: unknown) {
      return tx.write({ event: 'JOB_DELETE', action: 'DELETE', target: 'job' }, () => { const { id } = v.byId(input); repo.get(id); repo.remove(id); return { id } })
    },
    getJob(input: unknown) { return tx.read(() => { const { id } = v.byId(input); return repo.get(id) }) },
    listJobs(input: unknown) { return tx.read(() => repo.list(jobFilter(input))) },
    listSources(input: unknown) { return tx.read(() => { const args = v.object({ jobId: v.id, ...v.pageFields })(input); repo.get(args.jobId); return repo.sources(args.jobId, args.limit, args.offset) }) },
    registerCompany(input: unknown) {
      return tx.write({ event: 'COMPANY_REGISTER', action: 'CREATE', target: 'company' }, () => {
        const details = companyDetails(input), now = runtime.now()
        const company = { ...details, id: runtime.id(), normalizedName: details.name.trim().toLowerCase(), createdAt: now, updatedAt: now }
        repo.insertCompany(company)
        return company
      })
    },
    updateCompany(input: unknown) {
      return tx.write({ event: 'COMPANY_EDIT', action: 'UPDATE', target: 'company' }, () => {
        const { id, details } = v.object({ id: v.id, details: companyDetails })(input)
        const company = { ...repo.getCompany(id), ...details, normalizedName: details.name.trim().toLowerCase(), updatedAt: runtime.now() }
        repo.saveCompany(company)
        return company
      })
    },
    deleteCompany(input: unknown) {
      return tx.write({ event: 'COMPANY_DELETE', action: 'DELETE', target: 'company' }, () => { const { id } = v.byId(input); repo.getCompany(id); repo.removeCompany(id); return { id } })
    },
    listCompanies(input: unknown) { return tx.read(() => { const args = v.page(input); return repo.companies(args.limit, args.offset) }) }
  }
}
