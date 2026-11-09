import type { TargetType } from '../../domain/common/ports'

/** Internal table whitelist, independent of frozen historical migration SQL. */
export const entityTables: Readonly<Record<TargetType, string>> = Object.freeze({
  company: 'companies', job: 'jobs', job_source: 'job_sources', job_event: 'job_events',
  profile: 'profiles', profile_item: 'profile_items', fact: 'facts', generation_run: 'generation_runs',
  artifact: 'artifacts', artifact_fact: 'artifact_facts'
})
