# V1 Data Architecture and API

Purpose: define implemented local storage and business API boundaries. Status: **Implemented** transactional SQLite/audit, Settings/secrets, Profile editing/import, jobs/applications and Resume Agent V1 with immutable evidence, HTML/PDF output and asynchronous IPC. Remaining product flows are **Planned**.

Language: English · [简体中文](data-architecture.zh-CN.md)

## 1. Runtime and storage

[Main](../src/platform/electron/main/index.ts) opens `userData/database.sqlite` before creating a window. [SQLite initialization](../src/platform/database/sqlite.ts) uses Electron's built-in `node:sqlite`, one Main-owned connection, foreign keys, WAL, full synchronous durability and a 1-second busy timeout. Renderer never receives a connection or SQL interface. [App Context](../src/app/context/appContext.ts) holds nullable Job/Profile/Artifact IDs rather than entity copies; Profile initializes the shared Profile ID when selecting or saving its current record.

[Versioned migrations](../src/platform/database/migrations/index.ts) recognize database generation `0x4a415632` before journal/schema writes. Only empty or matching-generation databases are accepted; legacy databases fail with `INCOMPATIBLE_DATABASE_GENERATION` and are never reset, deleted or migrated. Development/acceptance must use separate userData. Matching databases use transactional migrations/checksums; future versions and mismatches fail startup. UUID v4 IDs cannot be reused after deletion; timestamps are UTC ISO strings.

The [shared ER diagram](diagrams/data-model.md) describes the implemented model. Concrete SQL types, defaults, nullability, checks and indexes live in [the schema](../src/platform/database/migrations/schema.ts) and [version-2 audit migration](../src/platform/database/migrations/ai-audit.ts), which preserves existing records and the 15 audit columns while extending fixed error codes. JSON uses validated TEXT columns; SQL tables are STRICT. Applications and Calendar use Job and JobEvent, without separate application/calendar tables.

| Tables | Ownership |
| --- | --- |
| `companies`, `jobs`, `job_sources` | Company identity, job details and preserved source content |
| `job_events` | Application lifecycle, schedules and notes |
| `profiles`, `profile_items`, `facts` | Contact information, structured containers and selectable evidence |
| `generation_runs`, `artifacts`, `artifact_facts` | Immutable inputs, generation stages, output and provenance |
| `audit_logs` | Content-free success/failure events |
| `capability_audit` | Content-free access/execution audit owned by read/write capabilities; [version-3 schema](../src/platform/database/migrations/capability-audit.ts) |

## 2. Business rules

[Job use cases](../src/domain/job/job.service.ts) accept allowlisted details. Sources normalize URL fragments/query order and hash cleaned content; public-URL extraction is implemented; duplicate matching/merging remain planned. Archiving is independent of application status. Deleting a Company detaches Jobs and preserves their raw company names.

[Add Job](../src/pages/find-jobs/AddJobPage.tsx) reuses `jobs.saveJob` to save the job and optional source atomically, without new tables or migrations. Title/company are required; new jobs are `NOT_STARTED` with null application/closure dates and no status event. Parsing drafts do not write business tables; source text and extracted JobPosting metadata are retained only on Save. Manual entry may omit the URL.

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

[Candidate use cases](../src/domain/candidate/candidate.service.ts) enforce same-profile parent/fact references, acyclic item nesting, valid date ranges and immutable item type. Item kinds are `EXPERIENCE / PROJECT / EDUCATION`. Fact kinds are `ACHIEVEMENT / RESPONSIBILITY / SKILL / AWARD / CERTIFICATION / COURSE / LANGUAGE / OTHER`. All saved Facts may participate in generation; no confirmation status, column or operation exists.

Each `ProfileItem` owns zero or more independently selectable Facts; each Fact belongs to one Profile and optionally one item in it. `parentItemId` relates items to items. Standalone skills/languages use a null `profileItemId`; fact kind does not determine ownership. `summary` stores background, while responsibilities/achievements remain individual Facts. The [fact service](../src/domain/candidate/fact.service.ts) validates edits and ownership.

[Item validation](../src/domain/candidate/candidate.validation.ts) supports `metadata.startDateText` / `endDateText` (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) and `isCurrent`. Import/manual UI writes day columns only for complete dates, validates ranges and never supplies missing months/days. The new database generation preserves partial-date precision in JSON metadata.

[Explicit import](../src/domain/candidate/import.service.ts) atomically applies submitted contact fields, appends links and inserts items/Facts. The [review selection](../src/pages/profile/import-state.ts) saves all valid, non-ignored content; any non-ignored invalid entry blocks submission and focuses its editor. Ignoring a parent excludes its facts. New profiles require a name. [Main sessions](../src/platform/profile-import/service.ts) enforce ownership, draft IDs, parent mappings, consumed entries and identical batch replay receipts. Partial saves retain parents for later facts. Duplicate uploads deliberately create new sessions; replay receipts are memory-only and cleared with the window/session.

Import creates `PROFILE_IMPORT` audit events for each changed record under a shared request/transaction; failure rolls all business rows and success audits back. Session/owner/replay checks precede business dispatch and do not create business audits; accepted transaction failures use ordinary failure audit. Only saved Fact excerpts/page numbers enter `evidence`; PDF bytes, full text and unsaved drafts stay in memory. AI audit retains its existing startup-only meaning.

## 3. Generation, output and deletion

[Resume requests](../src/domain/resume/resume.service.ts) atomically snapshot the Job, Profile, every saved Fact and all related items. Empty evidence and archived jobs fail. Configuration fixes `default-v1`, a default 500-word budget and the chosen provider/model; credentials stay outside snapshots. The [Domain ResumeAgent](../src/domain/resume/resume.agent.ts) runs score → gate → select → draft → validate → polish → validate → publish through an injected stage runner. Scoring persists `factId / score / reason` and output language from the job responsibilities/requirements, defaulting to English when unclear.

The [Main-only GenerationService](../src/domain/resume/generation.service.ts) persists stages; models receive read-only snapshot tools and cannot publish or write status. States are `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED / INTERRUPTED`. Gate rejection persists reasons/missing evidence and stops. Startup interrupts surviving pending/running attempts; retry creates a new run. Publishing atomically creates one Artifact and marks `SUCCEEDED`; later output failure/cancellation preserves it.

[ResumeDocument](../src/domain/resume/resume.types.ts) is the sole draft/polished/Artifact schema: language, application-copied basics and item metadata, summary, experience/projects/education bullets and skills. Each generated statement has a stable UUID, text and nonempty `factIds`. [Validation](../src/domain/resume/resume.validation.ts) enforces unique IDs, selected snapshot references, item ownership, unchanged basics and a language-aware budget; CJK characters count individually. Polish cannot add statement IDs, items or references to a draft statement. `artifact_facts` is derived from these statements; callers never submit separate provenance. Valid references do not prove semantic truth; [reviewed fixtures](../tests/fixtures/resume-evidence.json) explicitly mark invented metrics and expanded responsibility as unsupported.

[Output](../src/platform/resume-output/exporter.ts) embeds the pinned, licensed [Noto font](../resources/fonts/version.json), compiles escaped self-contained HTML, lays out A4 pages in an isolated Electron world after fonts load, and prints that same HTML to PDF. Entries/bullets prefer intact boundaries; long text splits across pages without shrinking/cropping. [File writes](../src/platform/resume-output/files.ts) use private temporary files, atomic replacement and relative HTML/PDF records under `userData/artifacts/`. Output state is independent; interrupted/missing output can be rebuilt without a model call. DOCX is unimplemented. Hard deletion preserves snapshots/generated output; it is not a privacy purge. Historical references carry `ACTIVE / DELETED` from deletion audit.

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

[Transactions](../src/platform/database/transactions.ts) and [database triggers](../src/platform/database/migrations/audit-triggers.ts) automatically append audit for every changed business row. Callers supply business parameters only. A write operation owns one internal transaction: all mutations and success audit commit together, or all roll back. Multi-row operations share a request and transaction ID. Ordinary business/audit queries remain read-only; explicit capability reads add access audit below.

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

**Agent model audit:** each non-streaming call attempts one fixed `AGENT_MODEL_RESULT` outcome using `recordAgentModel`; component `ai`, location `agent.model`, source `GENERATOR`, actor `resume-agent`. It stores only opaque request IDs and fixed outcomes, never prompts, output, keys or hidden reasoning. Audit failure terminates execution.

**Implemented audit browsing:** the read-only [Settings viewer](../src/pages/settings/AuditViewerSection.tsx) uses `audit.list` without schema/IPC changes. It defaults to 25 records per page, ordered by descending sequence. Type/status, exact target/request/transaction IDs and inclusive time boundaries compose existing filters. [Filter conversion](../src/pages/settings/audit-filters.ts) validates IDs/ranges and converts local datetime inputs to canonical UTC; details show localized time plus its stored UTC value. Refresh/reset/filter application restart at page one. Pages use offset pagination; new writes can shift subsequent pages, so refresh to see the latest ordering. No export, automatic polling, log mutation or business-content reconstruction is provided. Settings/key writes remain outside audit; AI success retains its startup-only meaning.

**Implemented capability audit:** [read/write wrappers](../src/platform/tools/capabilities.ts) validate arguments and commit `START` before invoking a Domain service or MCP Client, then commit one `END` with success/fixed error and elapsed time. Tool bindings do not write audit. Native writes reuse the existing business transaction, producing one business change audit per changed row plus a distinct capability access/outcome pair; external network waits never hold a SQLite transaction.

The [Main-only sink](../src/platform/database/capability-audit.ts) writes the append-only `capability_audit` table: invocation ID, phase, UTC timestamp, Main-bound Agent/run IDs, approved tool name/mode, optional Server/original name, validated native target type/UUID, duration, status and error. It stores no input, output, prompt, URL, command, credential or raw exception. Arguments rejected before execution create no access record. SQL guards and the authorizer reject forged inserts, updates and deletions.

Start-audit failure prevents execution. End-audit failure reports `TOOL_AUDIT_UNAVAILABLE` without retry or rollback claims; an external or committed local write may already have happened. On tool-runtime startup, unmatched starts receive an `INTERRUPTED` end, without re-executing work. The existing `audit.list`/Settings viewer still reads only business/AI `audit_logs`; capability diagnostics remain Main-only. [Tests](../tests/capability-audit.test.ts) cover privacy, failure, rollback and immutable records; [MCP architecture](mcp-architecture.md) owns execution policies/lifecycle.

## 5. API contract and access

The sandboxed [Preload](../src/platform/electron/preload/index.ts) exposes `window.data`. The complete typed inputs/outputs live in [DataContract](../src/platform/electron/data-contract.ts); field/enumeration definitions remain in the linked Domain types. [Main IPC](../src/platform/electron/main/data-ipc.ts) requires an owned window, its top frame and the exact trusted renderer document. External pages/subframes cannot access data.

Every method accepts one input object and resolves to `{ ok: true, value }` or `{ ok: false, error }`. Implemented business endpoints reject unknown fields, including injected audit/transaction fields. Edit-details methods replace the allowed details, applying documented type defaults; they are not arbitrary patches. Lists use `limit` (default 25, maximum 100) and `offset` (default 0, maximum 1000000), returning `{ items, total }` with stable ordering. Multi-table reads use a consistent read transaction.

Optional detail text and optional URLs default to empty strings, arrays to empty arrays, nullable IDs/dates/salary to null, and item order to 0. Required source/contact-link URLs must use HTTP(S) without credentials. ResumeDocument must contain at least one sourced statement; its budget uses the shared language-aware counter. Exact accepted shapes and limits are enforced by the Domain validation modules.

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
| `profiles.applyImport` | Explicit subset + session/batch IDs → saved Profile/items/Facts and draft-ID mappings; owner-checked, atomic |
| `profiles.addItem` | `{ profileId, parentItemId?, details }` → ProfileItem |
| `profiles.editItem`, `profiles.moveItem` | `{ id, details }` / `{ id, parentItemId, sortOrder }` → ProfileItem |
| `profiles.deleteItem`, `profiles.listItems` | `{ id }` / `{ profileId }` + Page → deleted ID / ProfileItems |
| `profiles.addFact`, `profiles.editFact` | `{ profileId, profileItemId?, details }` / `{ id, profileItemId?, details }` → Fact |
| `profiles.deleteFact`, `profiles.listFacts` | `{ id }` / `{ profileId }` + Page → deleted ID / Facts |
| `applications.changeStatus` | `{ jobId, status }` → Job and internally recorded status event |
| `applications.scheduleEvent` | `{ jobId, type, title, description?, startsAt, endsAt? }` → scheduled event |
| `applications.rescheduleEvent` | `{ id, startsAt, endsAt? }` → scheduled event |
| `applications.addNote`, `applications.deleteEvent` | `{ jobId, text }` / `{ id }` → event / deleted ID |
| `applications.listEvents`, `applications.listCalendar` | `{ jobId }` / `{ from, to }` + Page → events |
| `resumes.createRun` | `{ jobId, profileId, config? }` → GenerationRun |
| `resumes.cancelRun`, `resumes.deleteRun`, `resumes.getRun` | `{ id }` → run / deleted ID / `{ run, references }` |
| `resumes.listRuns` | Page + `jobId?` → `{ run, references }` entries, including deleted Job history |
| `resumes.getArtifact` | `{ id }` → `{ artifact, provenance, references }` |
| `resumes.editArtifact`, `resumes.deleteArtifact` | `{ id, title, content }` / `{ id }` → Artifact / deleted ID |
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

[The PDF import bridge](../src/platform/electron/profile-import-contract.ts) exposes `window.profileImport.selectPdf/start/cancel/discard/onEvent`, returning only a file summary, task stages, draft or fixed error codes; it offers no path-reading operation. Asynchronous file/network work stays outside synchronous business transactions.

The separate [AI API](../src/shared/ai.ts) retains streaming chat. [Resume IPC](../src/platform/electron/resume-contract.ts) exposes `window.resume.start/getTask/cancel/retryOutput/getPreview/exportPdf/onEvent`; events carry run ID and monotonic sequence, never hidden reasoning. Each window permits one active task; navigation preserves it, window disposal cancels it. Before publication cancel terminates the run; afterward it stops output only. Export opens a system save dialog and copies the existing PDF.

[The job import bridge](../src/platform/electron/job-import-contract.ts) exposes `window.jobImport.start/cancel/onEvent`, separately from synchronous business dispatch. New read/parse errors belong only to this bridge, without extending database audit codes. AI calls reuse startup audit; page/model content is not copied into audit.

## 6. Settings, secrets and remaining work

Main owns `database.sqlite`, its auxiliary files, `userData/settings.json` and `userData/secrets.enc`. Compiled HTML/PDF artifacts are stored under `userData/artifacts/`. Electron Session separately owns website cookies/storage. Ordinary business audit cannot be disabled.

The optional Main-only [MCP config](../src/platform/storage/mcp-config.ts) reads version-1 `userData/mcp.json` without creating/resetting it. Configuration contains reviewed stdio executable/arguments and tool manifests; it accepts no environment/credential fields and is excluded from Renderer preferences. MCP credentials/OAuth are planned; do not put secrets in command arguments. The [MCP document](mcp-architecture.md#4-configuration-and-lifecycle) owns configuration examples and limits.

[Preferences](../src/platform/storage/preferences.ts) validate version 1, English/Simplified Chinese, a `light / dark / system` theme and optional Gmail/Outlook/custom HTTPS webmail without embedded credentials. Existing version-1 light files remain compatible; the version stays 1. Light remains the default. Store the preference (including `system`), not its resolved color scheme; unrelated partial saves preserve it. Apply saved preferences only after successful atomic replacement. Missing files use defaults without writing. Partial saves merge the latest file; malformed/future files fail without resetting. [Atomic replacement](../src/platform/storage/files.ts) uses a private temporary file and rename; failed writes preserve previous data.

[AI preferences](../src/platform/storage/ai-preferences.ts) validate up to 20 named Provider instances, HTTPS Base URLs (HTTP only for localhost/loopback), explicit key requirements, up to 100 manually entered model IDs each and a nullable global provider/model default. Base URLs retain path prefixes but reject credentials, query strings and fragments. Old version-1 preferences without `ai` gain defaults in memory and are not rewritten until saved. Removing a provider in Settings requires deleting its key first; configuration removal takes effect on Save.

[Secrets](../src/platform/storage/secrets.ts) store version-2 ciphertext maps keyed by Provider instance ID, encrypted by Electron `safeStorage` at [Main composition](../src/platform/electron/main/index.ts). Unavailable encryption (including Linux `basic_text`) refuses saves; deletion remains available. The API returns configuration/encryption status, never decrypted keys. Keys stay outside ordinary preferences, SQLite, snapshots and audit; file preferences/key operations do not append business audit. Version-1 OpenAI ciphertext remains readable and upgrades atomically on the next key write without decrypting unrelated keys. Only the internal AI service can read plaintext through the injected capability; the public bridge returns status. Saving configuration/keys makes no model request; the explicit connection test sends a short prompt to the saved provider/model and can incur charges.

[Settings tests](../tests/settings.test.ts) verify reopen, all theme values, version-1 compatibility, partial-save preservation, validation, corruption, write failures and encrypted-key lifecycle. [Fallback adapters](../src/platform/storage/index.ts) return `NOT_IMPLEMENTED` only when a backend is composed without file services. AI chat uses local fixtures in [AI tests](../tests/ai.test.ts) and [production smoke](../scripts/ai-smoke.cjs); live third-party compatibility and account permissions remain unverified. Model discovery, strict structured-output negotiation, authenticated page extraction/deduplication, remaining business UI and full privacy purge remain unimplemented. Resume provider compatibility is verified by local fixtures; live providers remain unverified.

- [Current architecture](architecture.md): runtime initialization and process boundaries.
- [Code architecture](code-architecture.md): source ownership and quality checks.
- [Product architecture](product-architecture.md): planned product scope.
- [README](../README.md): validation commands and documentation index.
