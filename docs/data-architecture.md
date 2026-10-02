# V1 Data Architecture

Purpose: define the planned local, single-user data model, generation lifecycle, and storage rules. Status: **Planned**; the ER diagram is a logical design, not an executable SQLite schema.

Language: English · [简体中文](data-architecture.zh-CN.md)

## 1. Scope and implementation status

The design uses 11 tables across Job, Profile, Generation, Artifact, and Audit, plus ordinary settings and encrypted secrets files. Features share stable entity IDs rather than storing separate copies of jobs or facts.

**Implemented:** Electron, TypeScript, Home, and the browser foundation; see [current architecture](architecture.md). **Scaffolded:** [SQLite connection](../src/platform/database/sqlite.ts), [migrations](../src/platform/database/migrations/index.ts), [AI](../src/platform/ai/index.ts), and [settings storage](../src/platform/storage/index.ts) contain placeholders. No product database, generation pipeline, compilation, audit, or secrets service is wired into the [runtime entry](../src/main/index.ts).

Applications is a view of Job lifecycle data, not a separate table. Calendar is a planned Applications view over JobEvent, not an additional Home entry. Resume Builder corresponds to Tailor Resume; generated resumes are Artifacts. Initial Inbox remains webmail; an email event type does not imply email synchronization.

## 2. ER diagram and table ownership

Open the [complete Mermaid ER diagram](diagrams/data-model.md). This language-neutral shared asset preserves all supplied fields, keys, and 12 relationships; both editions reference the same diagram. `PK`, `FK`, and `UK` denote primary, foreign, and unique keys. Diagram types are logical types; concrete SQLite storage types remain a migration decision.

| ER entity / planned table | Responsibility |
| --- | --- |
| `COMPANY` / `companies` | Company identity, normalized name, domain, and branding |
| `JOB` / `jobs` | Job description, requirements, and application lifecycle |
| `JOB_SOURCE` / `job_sources` | URLs, source identity, cleaned content, and deduplication evidence |
| `JOB_EVENT` / `job_events` | Timeline and calendar events |
| `PROFILE` / `profiles` | Personal identity and contact information |
| `PROFILE_ITEM` / `profile_items` | Structured experience, project, and education containers |
| `FACT` / `facts` | Independently selectable and verifiable personal facts |
| `GENERATION_RUN` / `generation_runs` | One generation attempt, snapshots, and intermediate results |
| `ARTIFACT` / `artifacts` | Validated structured output and compiled file references |
| `ARTIFACT_FACT` / `artifact_facts` | Provenance from output blocks to facts |
| `AUDIT_LOG` / `audit_logs` | Business-data change history |

Each Job optionally belongs to one Company. Each source, event, and generation run belongs to exactly one Job. Each ProfileItem and Fact belongs to exactly one Profile; a Fact may optionally belong to one ProfileItem, and an item may optionally have one parent.

Each run produces zero or one Artifact; each Artifact belongs to exactly one run, enforced by a required, unique `generation_run_id`. Each ArtifactFact references one Artifact and one Fact. An AuditLog may optionally reference one run; `entity_type + entity_id` is a logical reference, not a polymorphic database foreign key.

## 3. Job and event rules

Job retains the raw company name even when no Company match exists. `location_text` retains source wording; `locations_json` describes raw text, city, state, country, and `ONSITE | HYBRID | REMOTE` work mode. `salary_json` holds optional minimum, maximum, currency, raw text, and `HOUR | DAY | WEEK | MONTH | YEAR` period. Requirements carry text, `REQUIRED | PREFERRED | OTHER` kind, and keywords.

Planned `application_status` values are `NOT_STARTED`, `PREPARING`, `APPLIED`, `INTERVIEW`, `OFFER`, `ACCEPTED`, `REJECTED`, and `WITHDRAWN`. Lifecycle timestamps and notes stay on Job; archiving is separate from application status. Transition rules remain to be specified.

Import cleans a page, parses it, then finds or creates a Job. Look up sources by normalized URL; use company, title, location, external ID, and fingerprint as matching evidence. Preserve uncertain matches as separate records. Store structured fields on Job and cleaned source content on JobSource for reparsing; these matching indexes are not automatic uniqueness or merge rules.

Planned event types are `STATUS_CHANGED`, `APPLICATION_SUBMITTED`, `EMAIL_RECEIVED`, `INTERVIEW`, `DEADLINE`, `FOLLOW_UP`, and `NOTE`. `occurred_at` records when something happened; `starts_at` and `ends_at` support scheduled calendar entries. `external_source + external_id` can assist deduplication; uniqueness policy remains open.

## 4. Profile and fact rules

ProfileItem types are `EXPERIENCE`, `PROJECT`, and `EDUCATION`. Common fields hold title, organization, role, location, dates, summary, and order. Type-specific metadata can hold employment type, project stack and links, or degree, major, and GPA.

A project may nest under experience or education. Parent and child must belong to the same Profile, and cycles are forbidden. A Fact's optional ProfileItem must belong to its Profile. These are additional integrity rules, not guarantees established by the ER relationships alone.

Facts hold content, tags, evidence, and `UNVERIFIED | CONFIRMED` verification status. Planned kinds cover Achievement, Responsibility, Skill, Award, Certification, Coursework, Language, and Other; stored enum spellings remain to be finalized. A Fact without `profile_item_id` is global to its Profile. Generation can select individual facts without selecting every fact in a container.

## 5. Generation and artifacts

The initial run type is `RESUME`. A run owns the following stages and records its configuration, status, error, and completion time; the status enum and retry policy remain open.

| Stage | Planned responsibility / stored result |
| --- | --- |
| Input | Snapshot Job, Profile, ProfileItems, and Facts in `input_snapshot_json` |
| Scoring | Record job-specific item and fact scores in `scores_json`; do not overwrite Facts |
| Gate | Store pass/fail, reason, and missing requirements in `gate_json`; stop if it fails |
| Selection | Store selected item/fact IDs, global fact IDs, and word budgets in `selection_json` |
| Draft | Write structured resume content to `draft_json` |
| Polish | Write refined content to `polished_json` |
| Validation | Check provenance and length; unverified text cannot automatically become confirmed fact |
| Compilation | Produce PDF / DOCX files for the validated Artifact |

Artifact `content_json` contains a header, optional summary block, and sections with items, headings, subtitles, date ranges, and bullet blocks. Blocks have stable IDs and text; items can refer to ProfileItems. Store the template ID and relative output file paths with the Artifact. Multiple export files belong to one Artifact, not multiple Artifacts for one run.

`artifact_facts` uses the composite primary key `(artifact_id, block_id, fact_id)`. One block can reference several facts, and one fact can support several artifacts. `block_id` refers to a block inside `content_json`, not another SQL table; validate block existence and update provenance together with content edits.

Input snapshots preserve the material used for a run. Historical output must remain interpretable after profile edits; fact deletion, revision handling, and snapshot versioning need explicit policies before migrations are implemented.

## 6. Audit and data integrity

Audit actions are `CREATE`, `UPDATE`, `DELETE`, and `MERGE`; actors are `USER`, `AI`, and `SYSTEM`. Record source, optional transaction/run IDs, before/after changes, and metadata. Write a business change and its audit record in the same SQLite transaction.

Audit is append-only during ordinary operations. Define access and retention limits for personal data, and allow removal through an explicit data-purge workflow. Never record API keys, tokens, or other secrets in audit or ordinary logs.

Use stable application-generated IDs, UTC ISO 8601 timestamps, and local-time display. Calendar dates such as ProfileItem dates require a separate date-only representation. Enable foreign-key enforcement. Do not cascade-delete Facts referenced by historical Artifacts or Jobs referenced by runs; prefer Job archiving and explicit purge workflows. Other deletion behavior remains to be designed; the model does not provide an archive field for every entity.

| Object | Planned constraints / indexes |
| --- | --- |
| Company | Ordinary indexes on `normalized_name`, `domain` |
| Job | Indexes on `company_id`, `application_status`, `saved_at` |
| JobSource | Indexes on `normalized_url`, `fingerprint` |
| JobEvent | Indexes on `job_id`, `starts_at` |
| ProfileItem | Indexes on `profile_id`, `parent_item_id`; same-profile, acyclic parent rules |
| Fact | Indexes on `profile_id`, `profile_item_id`; same-profile item rule |
| GenerationRun | Index on `(job_id, created_at)` |
| Artifact | Required and unique `generation_run_id` foreign key |
| ArtifactFact | Composite primary key `(artifact_id, block_id, fact_id)`; index on `fact_id` |
| AuditLog | Indexes on `(entity_type, entity_id, created_at)`, `transaction_id` |

## 7. Settings, secrets, and files

Planned application-owned storage under Electron's application data directory:

```text
userData/
├── database.sqlite
├── settings.json
├── secrets.enc
└── artifacts/
    ├── resume_001.pdf
    └── resume_001.docx
```

Electron Session separately owns website cookies and session data. The tree is a target layout, not a description of files currently created by the app.

| Settings group | Planned fields / proposed defaults |
| --- | --- |
| Root | `schemaVersion: 1` |
| `general` | `theme: system`, `language: en`, `autoSave: true` |
| `browser` | `homeUrl: about:blank`, `searchEngine: google`, `confirmBeforeSavingJob: true` |
| `ai` | `provider: openai`, empty `model`, `temperature: 0.3` |
| `generation` | `defaultTemplate: default`, `targetWordCount: 500`, `selectionThreshold: 70`, `outputFormat: PDF`, empty `outputDirectory` |
| `privacy` | Proposed `auditEnabled: true`; disabling semantics must be resolved against mandatory transactional audit |

These values are design inputs, not a working configuration file. `homeUrl` describes a future browser start preference; app launch still opens Home, and support for `about:blank` through navigation must be designed. Existing product requirements for Agent URL, default job site, and mailbox provider/web URL still need configuration keys. Empty model and output directory need validation/default-resolution rules.

Main owns settings reads and writes, using a temporary file and atomic replacement. Store encrypted API keys in `secrets.enc`, separately from SQLite, settings, snapshots, audit, and logs. Only Main decrypts secrets; Renderer receives narrow save, delete, and presence-check operations.

The target is Electron `safeStorage` backed by operating-system key protection, using `isAsyncEncryptionAvailable`, `encryptStringAsync`, and `decryptStringAsync`. These names were checked in the installed Electron 44.4.5 declarations (`node_modules/electron/electron.d.ts`), matching the [dependency lock](../package-lock.json); runtime behavior and backend availability remain unverified.

Check actual key protection before using secrets storage. On Linux, fail explicitly when suitable protection is unavailable rather than silently accepting a weak fallback.

## 8. Implementation decisions and related documents

Before schema migration work, resolve SQL types, nullability beyond relationship requirements, defaults, JSON shapes/versioning, enum checks, foreign-key deletion policies, duplicate handling, cross-profile validation, generation recovery, and database/file consistency on export failure. None are implemented by this diagram alone.

The proposal's `main/domains`, separate Jobs/Calendar/Resume pages, and service folders are conceptual responsibilities. Their code placement follows the existing [code architecture](code-architecture.md); no directory migration is introduced here.

- [Product architecture](product-architecture.md): scope, entry points, and delivery sequence.
- [Current architecture](architecture.md): verified runtime behavior and limitations.
- [README](../README.md): setup, validation, and documentation index.
