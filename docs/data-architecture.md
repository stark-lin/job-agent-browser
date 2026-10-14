# V1 Data Architecture and API

Purpose: define the implemented local storage model and public business API. Status: **Implemented** SQLite storage, transactional audit, business validation and IPC; AI chat and call audit are **Implemented**; AI business generation, compilation and business workflows remain **Planned**; Settings and encrypted secrets are **Implemented**; remaining business UI is **Scaffolded**.

Language: English · [简体中文](data-architecture.zh-CN.md)

## 1. Runtime and storage

[Main](../src/platform/electron/main/index.ts) opens `userData/database.sqlite` before creating a window. [SQLite initialization](../src/platform/database/sqlite.ts) uses Electron's built-in `node:sqlite`, one Main-owned connection, foreign keys, WAL, full synchronous durability and a 1-second busy timeout. Renderer never receives a connection or SQL interface. [App Context](../src/app/context/appContext.ts) holds nullable Job/Profile/Artifact IDs rather than entity copies; page skeletons do not implement business workflows.

[Versioned migrations](../src/platform/database/migrations/index.ts) create 11 data tables plus `schema_migrations` in a transaction. Recorded checksums detect changed migrations; newer schemas or mismatches fail startup without resetting data. A storage startup error prevents the window/API from opening. UUID v4 IDs are generated internally and cannot be reused after successful deletion. Times are UTC ISO strings; calendar dates use `YYYY-MM-DD`.

The [shared ER diagram](diagrams/data-model.md) describes the implemented model. Concrete SQL types, defaults, nullability, checks and indexes live in [the schema](../src/platform/database/migrations/schema.ts) and [version-2 audit migration](../src/platform/database/migrations/ai-audit.ts), which preserves existing records and the 15 audit columns while extending fixed error codes. JSON uses validated TEXT columns; SQL tables are STRICT. Applications and Calendar use Job and JobEvent, without separate application/calendar tables.

| Tables | Ownership |
| --- | --- |
| `companies`, `jobs`, `job_sources` | Company identity, job details and preserved source content |
| `job_events` | Application lifecycle, schedules and notes |
| `profiles`, `profile_items`, `facts` | Contact information, structured containers and selectable evidence |
| `generation_runs`, `artifacts`, `artifact_facts` | Immutable inputs, generation stages, output and provenance |
| `audit_logs` | Content-free success/failure events |

## 2. Business rules

[Job use cases](../src/domain/job/job.service.ts) accept allowlisted details. Sources normalize URL fragments/query order and hash cleaned content; duplicate matching/merging and page extraction remain planned. Archiving is independent of application status. Deleting a Company detaches Jobs and preserves their raw company names.

[Application use cases](../src/domain/application/application.service.ts) write status changes and timeline events atomically. Allowed transitions are:

| Current status | Allowed next statuses |
| --- | --- |
| `NOT_STARTED` | `PREPARING`, `APPLIED`, `WITHDRAWN` |
| `PREPARING` | `NOT_STARTED`, `APPLIED`, `WITHDRAWN` |
| `APPLIED` | `INTERVIEW`, `OFFER`, `REJECTED`, `WITHDRAWN` |
| `INTERVIEW` | `OFFER`, `REJECTED`, `WITHDRAWN` |
| `OFFER` | `ACCEPTED`, `REJECTED`, `WITHDRAWN` |
| `ACCEPTED`, `REJECTED`, `WITHDRAWN` | Terminal; no status change |

Archived Jobs reject status changes and scheduling/rescheduling. `APPLIED` sets the application time; terminal states set the closed time. System-created status events cannot be independently deleted. Calendar bounds are inclusive and filter schedule start times. Email synchronization/events remain planned.

[Candidate use cases](../src/domain/candidate/candidate.service.ts) enforce same-profile parent/fact references, acyclic item nesting, valid date ranges and immutable item type. Item kinds are `EXPERIENCE / PROJECT / EDUCATION`. Fact kinds are `ACHIEVEMENT / RESPONSIBILITY / SKILL / AWARD / CERTIFICATION / COURSE / LANGUAGE / OTHER`. New or edited facts are `UNVERIFIED`; only `confirmFact` marks them `CONFIRMED`.

## 3. Generation, output and deletion

[Resume requests](../src/domain/resume/resume.service.ts) capture a version-1 snapshot of Job, Profile, selected Facts, selected Items and required ancestors. Empty fact selection, foreign-profile evidence and archived Jobs are rejected. Unverified facts retain their status in the snapshot. Configuration defaults to template `default` and 500 words; inputs and configuration are immutable.

The [Main-only generation service](../src/domain/resume/generation.service.ts) persists start → scores → gate → selection → draft → polish → validated artifact. It does not call an AI provider or compiler. States are `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED / INTERRUPTED`. Gate failure stops the run. Startup marks surviving `RUNNING` attempts `INTERRUPTED` with SYSTEM audit. Retrying creates a new run from current inputs. Running runs must be cancelled before deletion.

[Artifact validation](../src/domain/resume/resume.validation.ts) checks unique content IDs, selected snapshot references, complete block provenance and the selected word budget. Each run has at most one Artifact. Editing content and provenance is atomic and clears stale output file references. Main-only output recording accepts one relative PDF and one relative DOCX path; compilation and filesystem consistency are still planned.

Hard deletion removes source entities while preserving historical generated output and immutable snapshots. History still contains business content; deletion is not a privacy purge. References returned by `getRun`, `listRuns` and `getArtifact` carry `ACTIVE / DELETED` and `deletedAt`; only successful deletion audit establishes the deleted state.

| Deleted object | Result |
| --- | --- |
| Job | Remove sources/events; retain generation runs and artifacts |
| Profile | Remove all items/facts; retain generation history |
| ProfileItem | Remove its descendant subtree and attached facts |
| Fact | Remove source fact; retain historical artifact links |
| GenerationRun | Remove its artifact and artifact links |
| Artifact | Remove its links; retain the run |

`generation_runs.job_id` and `artifact_facts.fact_id` are stable logical references so historical sources can disappear. Snapshot IDs are also logical references. All other ownership relationships use foreign keys. Audit survives every business deletion; no audit-clear or disk-file-cleanup API is implemented.

## 4. Audit and transactions

[Transactions](../src/platform/database/transactions.ts) and [database triggers](../src/platform/database/migrations/audit-triggers.ts) automatically append audit for every changed business row. Callers supply business parameters only. A write operation owns one internal transaction: all mutations and success audit commit together, or all roll back. Multi-row operations share a request and transaction ID. Query and audit-query operations never write audit.

| Element | SQL fields | Allowed contents |
| --- | --- | --- |
| What | `event_type`, `action` | Fixed operation name; `CREATE / UPDATE / DELETE` |
| When | `timestamp` | Backend-generated UTC time |
| Where | `component`, `location` | Logical component/operation identifiers |
| Source | `source`, `request_id` | Trusted entry category and generated request UUID |
| Outcome | `status`, `error` | `SUCCESS / FAILURE`; error code only |
| Identity | `actor_id`, `target_type`, `target_id` | Opaque subject and business object identifiers |

Additional fields are `id`, monotonically increasing `sequence` and `transaction_id`. ArtifactFact targets encode their three opaque key IDs as a JSON array string. USER, AI and SYSTEM use fixed local identifiers; source is `RENDERER / GENERATOR / STARTUP / AI_CLIENT`. This is a local single-user identity scheme, not multi-user authentication. Public DTO fields use camelCase.

No before/after values, arbitrary metadata, business bodies, prompts, credentials, raw exception messages, stack traces, physical paths or page URLs are retained in audit. An SQL authorizer and triggers reject audit updates/deletions and forged inserts. Business writes without the internal context are rejected. Successful no-op operations with no changed rows create no success record; a generation gate rejection is a successful persistence operation whose run state becomes FAILED.

Failed writes first roll back, then append one failure audit in a separate transaction. The failure retains its request ID; its transaction ID belongs to the failure-audit transaction. A validated target ID is included when known, otherwise null. Invalid business write input is audited without copying input. If failure audit cannot persist, return `AUDIT_UNAVAILABLE`; do not claim it was recorded. Untrusted/unknown IPC requests are rejected before business execution. Settings/secrets use separate file adapters and never place credentials in SQLite or audit.

**Implemented AI call audit:** the Main-internal `recordAI` capability in [Transactions](../src/platform/database/transactions.ts) writes `AI_STREAM_START`, `CREATE`, component `ai`, location `chat.stream`, source `AI_CLIENT` and actor `local-user`. `targetType = ai_request`; target/request IDs are the same generated opaque request UUID, with no business-object mapping. Time, record ID and transaction ID are database-layer generated. [Audit queries](../src/platform/database/audit-reader.ts) accept this logical target without treating it as a business entity/table.

Each accepted request attempts one audit: the first valid SSE chunk commits `SUCCESS` before content is forwarded; startup failure/cancellation commits `FAILURE` with a fixed code. Success means the stream started, not that output completed. Post-start completion, failure and cancellation add no call audit. A manual retry creates a new request. Audit failure stops forwarding/aborts the request and reports `AUDIT_UNAVAILABLE`; the external call may already have occurred. No provider/model/URL, usage, duration, message, prompt, output, business snapshot or extra metadata is persisted. Chat history remains page-memory only; no AI run/message tables are added.

**Implemented audit browsing:** the read-only [Settings viewer](../src/pages/settings/AuditViewerSection.tsx) uses `audit.list` without schema/IPC changes. It defaults to 25 records per page, ordered by descending sequence. Type/status, exact target/request/transaction IDs and inclusive time boundaries compose existing filters. [Filter conversion](../src/pages/settings/audit-filters.ts) validates IDs/ranges and converts local datetime inputs to canonical UTC; details show localized time plus its stored UTC value. Refresh/reset/filter application restart at page one. Pages use offset pagination; new writes can shift subsequent pages, so refresh to see the latest ordering. No export, automatic polling, log mutation or business-content reconstruction is provided. Settings/key writes remain outside audit; AI success retains its startup-only meaning.

## 5. API contract and access

The sandboxed [Preload](../src/platform/electron/preload/index.ts) exposes `window.data`. The complete typed inputs/outputs live in [DataContract](../src/platform/electron/data-contract.ts); field/enumeration definitions remain in the linked Domain types. [Main IPC](../src/platform/electron/main/data-ipc.ts) requires an owned window, its top frame and the exact trusted renderer document. External pages/subframes cannot access data.

Every method accepts one input object and resolves to `{ ok: true, value }` or `{ ok: false, error }`. Implemented business endpoints reject unknown fields, including injected audit/transaction fields. Edit-details methods replace the allowed details, applying documented type defaults; they are not arbitrary patches. Lists use `limit` (default 25, maximum 100) and `offset` (default 0, maximum 1000000), returning `{ items, total }` with stable ordering. Multi-table reads use a consistent read transaction.

Optional detail text and optional URLs default to empty strings, arrays to empty arrays, nullable IDs/dates/salary to null, and item order to 0. Required source/contact-link URLs must use HTTP(S) without credentials. Content must contain at least one text block; its word budget counts whitespace-delimited words in summary/bullet blocks. Exact accepted shapes and limits are enforced by the Domain validation modules.

| Namespace / methods | Input and result / behavior |
| --- | --- |
| `jobs.saveJob` | `{ details, source? }` → Job; optionally attach source atomically |
| `jobs.updateDetails` | `{ id, details }` → Job; lifecycle fields are excluded |
| `jobs.attachSource` | `{ jobId, source }` → JobSource |
| `jobs.setArchived` | `{ id, archived }` → Job |
| `jobs.deleteJob`, `jobs.getJob` | `{ id }` → deleted ID / Job |
| `jobs.listJobs` | Page + `status? / archived? / search?` → Jobs; default unarchived |
| `jobs.listSources` | `{ jobId }` + Page → JobSources |
| `jobs.registerCompany`, `jobs.updateCompany` | Company details / `{ id, details }` → Company |
| `jobs.deleteCompany`, `jobs.listCompanies` | `{ id }` / Page → deleted ID / Companies |
| `profiles.createProfile`, `profiles.editContact` | Contact details / `{ id, details }` → Profile |
| `profiles.getProfile`, `profiles.deleteProfile`, `profiles.listProfiles` | `{ id }` / Page → Profile / deleted ID / Profiles |
| `profiles.addItem` | `{ profileId, parentItemId?, details }` → ProfileItem |
| `profiles.editItem`, `profiles.moveItem` | `{ id, details }` / `{ id, parentItemId, sortOrder }` → ProfileItem |
| `profiles.deleteItem`, `profiles.listItems` | `{ id }` / `{ profileId }` + Page → deleted ID / ProfileItems |
| `profiles.addFact`, `profiles.editFact` | `{ profileId, profileItemId?, details }` / `{ id, profileItemId?, details }` → Fact |
| `profiles.confirmFact`, `profiles.deleteFact`, `profiles.listFacts` | `{ id }` / `{ profileId }` + Page → Fact / deleted ID / Facts |
| `applications.changeStatus` | `{ jobId, status }` → Job and internally recorded status event |
| `applications.scheduleEvent` | `{ jobId, type, title, description?, startsAt, endsAt? }` → scheduled event |
| `applications.rescheduleEvent` | `{ id, startsAt, endsAt? }` → scheduled event |
| `applications.addNote`, `applications.deleteEvent` | `{ jobId, text }` / `{ id }` → event / deleted ID |
| `applications.listEvents`, `applications.listCalendar` | `{ jobId }` / `{ from, to }` + Page → events |
| `resumes.createRun` | `{ jobId, profileId, factIds, itemIds?, config? }` → GenerationRun |
| `resumes.cancelRun`, `resumes.deleteRun`, `resumes.getRun` | `{ id }` → run / deleted ID / `{ run, references }` |
| `resumes.listRuns` | Page + `jobId?` → `{ run, references }` entries, including deleted Job history |
| `resumes.getArtifact` | `{ id }` → `{ artifact, provenance, references }` |
| `resumes.editArtifact`, `resumes.deleteArtifact` | `{ id, title, content, provenance }` / `{ id }` → Artifact / deleted ID |
| `audit.list` | Page + `targetType? / targetId? / requestId? / transactionId? / status? / from? / to?` → audit entries, newest sequence first |
| `settings.get`, `settings.savePreferences` | `{}` / partial language, `light / dark / system` theme, mailbox or `ai` configuration → versioned Preferences |
| `secrets.hasProviderKey`, `secrets.saveProviderKey`, `secrets.deleteProviderKey` | Provider instance ID as `provider`; save also accepts `apiKey` → `{ configured, available }`, never a key |

```ts
const saved = await window.data.jobs.saveJob({
  details: { title: 'Software Engineer', companyNameRaw: 'Example' }
})
if (saved.ok) {
  const history = await window.data.audit.list({ targetType: 'job', targetId: saved.value.id })
}
```

The API offers no raw SQL/table CRUD, unrestricted filters, transaction management, audit writer or generation-stage writes. Main alone persists generation stages with its trusted service identity. Callers should branch on the following codes rather than database messages. Mutations are not automatically retried/idempotent; refresh uncertain state before retrying.

| Error code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Unknown field, invalid shape/value or exceeded input/query limit |
| `NOT_FOUND` | Requested live entity does not exist |
| `CONFLICT` | Relationship, immutable data, provenance or SQL integrity violation |
| `INVALID_STATE` | Disallowed lifecycle transition, generation stage or operation |
| `STORAGE_BUSY` | Database lock contention exceeded the wait limit |
| `STORAGE_UNAVAILABLE` | Storage operation could not complete; raw error details are withheld |
| `AUDIT_UNAVAILABLE` | Required business/call audit could not be committed; the operation reports failure |
| `NOT_IMPLEMENTED` | Storage adapter was not supplied to a non-production backend |
| `ENCRYPTION_UNAVAILABLE` | OS-backed encryption is unavailable; key saving is refused |
| `FORBIDDEN` | IPC caller is not the trusted top-level renderer document or request owner |
| `AI_NOT_CONFIGURED`, `AI_AUTH_FAILED`, `AI_RATE_LIMITED` | Missing provider/model/key, rejected authorization or rate limit |
| `AI_PROVIDER_FAILED`, `AI_PROTOCOL_ERROR`, `AI_CONNECT_FAILED`, `AI_TIMEOUT`, `AI_CANCELLED` | Provider, stream format, transport, timeout or cancellation outcome |

The separate [AI API](../src/shared/ai.ts) exposes `window.ai.start`, `cancel` and `onEvent`; it does not extend synchronous data dispatch or expose an audit writer. Runtime streaming and lifecycle behavior are owned by [current architecture](architecture.md).

## 6. Settings, secrets and remaining work

Main owns `database.sqlite`, its auxiliary files, `userData/settings.json` and `userData/secrets.enc`. Compiled artifacts under `userData/artifacts/` remain planned. Electron Session separately owns website cookies/storage. Ordinary business audit cannot be disabled.

[Preferences](../src/platform/storage/preferences.ts) validate version 1, English/Simplified Chinese, a `light / dark / system` theme and optional Gmail/Outlook/custom HTTPS webmail without embedded credentials. Existing version-1 light files remain compatible; the version stays 1. Light remains the default. Store the preference (including `system`), not its resolved color scheme; unrelated partial saves preserve it. Apply saved preferences only after successful atomic replacement. Missing files use defaults without writing. Partial saves merge the latest file; malformed/future files fail without resetting. [Atomic replacement](../src/platform/storage/files.ts) uses a private temporary file and rename; failed writes preserve previous data.

[AI preferences](../src/platform/storage/ai-preferences.ts) validate up to 20 named Provider instances, HTTPS Base URLs (HTTP only for localhost/loopback), explicit key requirements, up to 100 manually entered model IDs each and a nullable global provider/model default. Base URLs retain path prefixes but reject credentials, query strings and fragments. Old version-1 preferences without `ai` gain defaults in memory and are not rewritten until saved. Removing a provider in Settings requires deleting its key first; configuration removal takes effect on Save.

[Secrets](../src/platform/storage/secrets.ts) store version-2 ciphertext maps keyed by Provider instance ID, encrypted by Electron `safeStorage` at [Main composition](../src/platform/electron/main/index.ts). Unavailable encryption (including Linux `basic_text`) refuses saves; deletion remains available. The API returns configuration/encryption status, never decrypted keys. Keys stay outside ordinary preferences, SQLite, snapshots and audit; file preferences/key operations do not append business audit. Version-1 OpenAI ciphertext remains readable and upgrades atomically on the next key write without decrypting unrelated keys. Only the internal AI service can read plaintext through the injected capability; the public bridge returns status. Saving configuration/keys makes no model request; the explicit connection test sends a short prompt to the saved provider/model and can incur charges.

[Settings tests](../tests/settings.test.ts) verify reopen, all theme values, version-1 compatibility, partial-save preservation, validation, corruption, write failures and encrypted-key lifecycle. [Fallback adapters](../src/platform/storage/index.ts) return `NOT_IMPLEMENTED` only when a backend is composed without file services. AI chat uses local fixtures in [AI tests](../tests/ai.test.ts) and [production smoke](../scripts/ai-smoke.cjs); live third-party compatibility and account permissions remain unverified. Model discovery, tools, structured-output integration, AI business generation, extraction/deduplication, compilation, remaining business UI and full privacy purge remain unimplemented.

- [Current architecture](architecture.md): runtime initialization and process boundaries.
- [Code architecture](code-architecture.md): source ownership and quality checks.
- [Product architecture](product-architecture.md): planned product scope.
- [README](../README.md): validation commands and documentation index.
