import type { References } from '../common/ports'
import type { InputSnapshot } from './resume.types'

export function snapshotReferences(snapshot: InputSnapshot, refs: References) {
  return [refs.resolve('job', snapshot.job.id), refs.resolve('profile', snapshot.profile.id),
    ...(snapshot.job.companyId ? [refs.resolve('company', snapshot.job.companyId)] : []),
    ...snapshot.items.map((item) => refs.resolve('profile_item', item.id)),
    ...snapshot.facts.map((fact) => refs.resolve('fact', fact.id))]
}
