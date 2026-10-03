// SQL is private to Platform. JSON is versioned/validated by the domain before reaching these tables.
const json = (name: string, nullable = false) => `${name} TEXT ${nullable ? '' : 'NOT NULL'} CHECK (${nullable ? `${name} IS NULL OR ` : ''}json_valid(${name}))`
export const initialSchema = `
CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, domain TEXT NOT NULL,
  website TEXT NOT NULL, logo_url TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  company_name_raw TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, location_text TEXT NOT NULL,
  ${json('locations_json')}, employment_type TEXT NOT NULL, ${json('salary_json', true)}, ${json('requirements_json')},
  application_status TEXT NOT NULL CHECK (application_status IN ('NOT_STARTED','PREPARING','APPLIED','INTERVIEW','OFFER','ACCEPTED','REJECTED','WITHDRAWN')),
  saved_at TEXT NOT NULL, applied_at TEXT, closed_at TEXT, archived_at TEXT, notes TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE job_sources (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL, normalized_url TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL,
  page_title TEXT NOT NULL, cleaned_content TEXT NOT NULL, fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
) STRICT;
CREATE TABLE job_events (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('STATUS_CHANGED','APPLICATION_SUBMITTED','INTERVIEW','DEADLINE','FOLLOW_UP','NOTE')),
  title TEXT NOT NULL, description TEXT NOT NULL, occurred_at TEXT NOT NULL, starts_at TEXT, ends_at TEXT,
  external_source TEXT NOT NULL, external_id TEXT NOT NULL, ${json('metadata_json')},
  CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at >= starts_at))
) STRICT;
CREATE TABLE profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, location TEXT NOT NULL,
  ${json('links_json')}, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE profile_items (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_item_id TEXT REFERENCES profile_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('EXPERIENCE','PROJECT','EDUCATION')),
  title TEXT NOT NULL, organization TEXT NOT NULL, role TEXT NOT NULL, location TEXT NOT NULL,
  start_date TEXT, end_date TEXT, summary TEXT NOT NULL, ${json('metadata_json')}, sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
) STRICT;
CREATE TABLE facts (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_item_id TEXT REFERENCES profile_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('ACHIEVEMENT','RESPONSIBILITY','SKILL','AWARD','CERTIFICATION','COURSE','LANGUAGE','OTHER')),
  content TEXT NOT NULL, ${json('tags_json')}, evidence TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK(verification_status IN ('UNVERIFIED','CONFIRMED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type = 'RESUME'),
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
  ${json('input_snapshot_json')}, ${json('scores_json', true)}, ${json('gate_json', true)}, ${json('selection_json', true)},
  ${json('draft_json', true)}, ${json('polished_json', true)}, ${json('config_json')}, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
) STRICT;
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, generation_run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type = 'RESUME'), title TEXT NOT NULL, ${json('content_json')},
  template_id TEXT NOT NULL, ${json('output_files_json')}, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE artifact_facts (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, block_id TEXT NOT NULL, fact_id TEXT NOT NULL,
  PRIMARY KEY (artifact_id, block_id, fact_id)
) STRICT;
CREATE TABLE audit_logs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','DELETE')),
  timestamp TEXT NOT NULL, component TEXT NOT NULL, location TEXT NOT NULL, source TEXT NOT NULL,
  request_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('SUCCESS','FAILURE')),
  error TEXT CHECK(error IN ('INVALID_INPUT','NOT_FOUND','CONFLICT','INVALID_STATE','STORAGE_BUSY','STORAGE_UNAVAILABLE','AUDIT_UNAVAILABLE','NOT_IMPLEMENTED','FORBIDDEN')),
  actor_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, transaction_id TEXT NOT NULL,
  CHECK ((status = 'SUCCESS' AND error IS NULL AND target_id IS NOT NULL) OR (status = 'FAILURE' AND error IS NOT NULL))
) STRICT;
CREATE INDEX companies_name ON companies(normalized_name);
CREATE INDEX companies_domain ON companies(domain);
CREATE INDEX jobs_company ON jobs(company_id);
CREATE INDEX jobs_status ON jobs(application_status);
CREATE INDEX jobs_saved ON jobs(saved_at, id);
CREATE INDEX sources_job ON job_sources(job_id);
CREATE INDEX sources_url ON job_sources(normalized_url);
CREATE INDEX sources_fingerprint ON job_sources(fingerprint);
CREATE INDEX events_job ON job_events(job_id, occurred_at, id);
CREATE INDEX events_starts ON job_events(starts_at, id);
CREATE INDEX items_profile ON profile_items(profile_id, sort_order, id);
CREATE INDEX items_parent ON profile_items(parent_item_id);
CREATE INDEX facts_profile ON facts(profile_id, created_at, id);
CREATE INDEX facts_item ON facts(profile_item_id);
CREATE INDEX runs_job ON generation_runs(job_id, created_at, id);
CREATE INDEX artifact_fact_source ON artifact_facts(fact_id);
CREATE INDEX audit_target ON audit_logs(target_type, target_id, sequence);
CREATE INDEX audit_transaction ON audit_logs(transaction_id, sequence);
CREATE INDEX audit_request ON audit_logs(request_id, sequence);
CREATE INDEX audit_time ON audit_logs(timestamp, sequence);
CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON generation_runs
WHEN NEW.input_snapshot_json IS NOT OLD.input_snapshot_json OR NEW.job_id IS NOT OLD.job_id OR NEW.config_json IS NOT OLD.config_json
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END;
`
