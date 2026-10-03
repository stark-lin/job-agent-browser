import type { ApplicationRepository } from '../../../domain/application/application.repository'
import type { Store } from './store'
export function applicationRepository(store: Store): ApplicationRepository {
  return {
    getEvent: (id) => store.get('job_event', id), insertEvent: (event) => store.insert('job_event', event), saveEvent: (event) => store.save('job_event', event), removeEvent: (id) => store.remove('job_event', id),
    events: (id, limit, offset) => store.list('job_events', 'job_id=?', [id], 'occurred_at DESC, id', limit, offset),
    calendar: (from, to, limit, offset) => store.list('job_events', 'starts_at >= ? AND starts_at <= ?', [from, to], 'starts_at, id', limit, offset)
  }
}
