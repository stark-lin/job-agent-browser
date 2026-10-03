import { createHash } from 'node:crypto'
import type { SQLInputValue } from 'node:sqlite'
import type { JobRepository } from '../../../domain/job/job.repository'
import type { Store } from './store'

export function jobRepository(store: Store): JobRepository {
  return {
    get: (id) => store.get('job', id), insert: (job) => store.insert('job', job), save: (job) => store.save('job', job), remove: (id) => store.remove('job', id),
    list(filter) {
      const where = [filter.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'], args: SQLInputValue[] = []
      if (filter.status) { where.push('application_status=?'); args.push(filter.status) }
      if (filter.search) { where.push("(title LIKE ? ESCAPE '\\' OR company_name_raw LIKE ? ESCAPE '\\')"); const term = `%${filter.search.replace(/[\\%_]/g, '\\$&')}%`; args.push(term, term) }
      return store.list('jobs', where.join(' AND '), args, 'saved_at DESC, id', filter.limit, filter.offset)
    },
    getCompany: (id) => store.get('company', id), companies: (limit, offset) => store.list('companies', '1=1', [], 'normalized_name, id', limit, offset),
    insertCompany: (company) => store.insert('company', company), saveCompany: (company) => store.save('company', company),
    removeCompany(id) {
      store.db.prepare('UPDATE jobs SET company_id=NULL, updated_at=? WHERE company_id=?').run(new Date().toISOString(), id)
      store.remove('company', id)
    },
    sources: (id, limit, offset) => store.list('job_sources', 'job_id=?', [id], 'first_seen_at, id', limit, offset),
    insertSource(source) { source.fingerprint = createHash('sha256').update(source.cleanedContent).digest('hex'); store.insert('job_source', source) }
  }
}
