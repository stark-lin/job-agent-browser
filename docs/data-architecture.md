# V1 Data Architecture and API

Purpose: define implemented local storage and business API boundaries. Status: **Implemented** transactional SQLite/audit, Settings/secrets, Profile editing/import, Job Capture/Application Agents and Resume Agent V1 with immutable evidence, HTML/PDF output and asynchronous IPC. Remaining product flows are **Planned**.

Language: English · [简体中文](data-architecture.zh-CN.md)

## 1. Runtime and storage

[Main](../src/platform/electron/main/index.ts) and the [local MCP Server](../src/platform/mcp-server/runtime.ts) each open one `node:sqlite` connection to the explicit userData database. [SQLite initialization](../src/platform/database/sqlite.ts) enables foreign keys, WAL, full synchronous durability and a 1-second busy timeout. Renderer receives no SQL. [App Context](../src/app/context/appContext.ts) holds Job/Profile/Artifact IDs rather than record copies.

[Versioned migrations](../src/platform/database/migrations/index.ts) recognize database generation `0x4a415632` before journal/schema writes. Only empty or matching-generation databases are accepted; legacy databases fail with `INCOMPATIBLE_DATABASE_GENERATION` and are never reset, deleted or migrated. Development/acceptance must use separate userData. Matching databases use transactional migrations/checksums; future versions and mismatches fail startup. UUID v4 IDs cannot be reused after deletion; timestamps are UTC ISO strings.

The [shared ER diagram](diagrams/data-model.md) describes the implemented model. Concrete SQL types, defaults, nullability, checks and indexes live in [the schema](../src/platform/database/migrations/schema.ts) and [version-2 audit migration](../src/platform/database/migrations/ai-audit.ts), which preserves existing records and the 15 audit columns while extending fixed error codes. JSON uses validated TEXT columns; SQL tables are STRICT. Applications and Calendar use Job and JobEvent, without separate application/calendar tables.

| Tables | Ownership |
| --- | --- |
| `companies`, `jobs`, `job_sources` | Company identity, job details and preserved source content |
| `job_events` | Application lifecycle, schedules and notes |
| `profiles`, `profile_items`, `facts` | Contact information, personal introduction, structured containers and selectable evidence |
| `generation_runs`, `artifacts`, `artifact_facts` | Immutable inputs, generation stages, output and provenance |
| `audit_logs` | Content-free success/failure events |
| `capability_audit` | Content-free access/execution audit owned by read/write capabilities; [version-3 schema](../src/platform/database/migrations/capability-audit.ts) |
| `runtime_instances`, `runtime_work`, `invocation_owners`, `resume_start_receipts` | Process/work ownership, invocation ownership and atomic start receipts; [version-4 schema](../src/platform/database/migrations/runtime-leases.ts) |
| `operation_receipts` | Cross-session creation receipts; [version-5 schema](../src/platform/database/migrations/operation-receipts.ts) |
| `chat_sessions`, `chat_runs`, `chat_items` | Host-owned transcript/model snapshots, request receipts, ordered visible items; [additive version-6 schema](../src/platform/database/migrations/chat.ts) |

## 2. Business rules

[Job use cases](../src/domain/job/job.service.ts) accept allowlisted details. Sources normalize URL fragments/query order and hash cleaned content; public-URL extraction is implemented; duplicate matching/merging remain planned. Archiving is independent of application status. Deleting a Company detaches Jobs and preserves their raw company names.

[Add Job](../src/pages/find-jobs/AddJobPage.tsx) uses typed IPC for manual saves and MCP job.import for reviewed Agent drafts; both reuse jobs.saveJob atomically. Title/company are required, new jobs are NOT_STARTED with null application/closure dates and no event. URL/text/PDF parsing does not write business tables; optional genuine web source is retained only on Save. Text/PDF without a URL uses source:null. Durable receipts are described below.

[Application use cases](../src/domain/application/application.service.ts) write status changes and timeline events atomically. Allowed transitions are:

| Current status | Allowed next statuses |
| --- | --- |
| `NOT_STARTED` | `PREPARING`, `APPLIED`, `WITHDRAWN` |
| `PREPARING` | `NOT_STARTED`, `APPLIED`, `WITHDRAWN` |
| `APPLIED` | `INTERVIEW`, `OFFER`, `REJECTED`, `WITHDRAWN` |
| `INTERVIEW` | `OFFER`, `REJECTED`, `WITHDRAWN` |
| `OFFER` | `ACCEPTED`, `REJECTED`, `WITHDRAWN` |
| `ACCEPTED`, `REJECTED`, `WITHDRAWN` | Terminal; no status change |

Archived Jobs reject status changes and scheduling/rescheduling but permit notes and detail edits. Same-state status requests return unchanged data without duplicate events; same-value detail/archive/reschedule requests do not mutate. [Application workflow](../src/domain/application/workflow.ts) owns transitions and allowedNextStatuses. APPLIED sets application time and terminal states set closure time. System-created status events cannot be deleted independently. Calendar bounds are inclusive; email synchronization remains planned.

[Candidate use cases](../src/domain/candidate/candidate.service.ts) enforce same-profile parent/fact references, acyclic item nesting, valid date ranges and immutable item type. Item kinds are `EXPERIENCE / PROJECT / EDUCATION`. Fact kinds are `ACHIEVEMENT / RESPONSIBILITY / SKILL / AWARD / CERTIFICATION / COURSE / LANGUAGE / OTHER`. All saved Facts may participate in generation; no confirmation status, column or operation exists.

`Profile.introduction` is optional personal wording (up to 2,000 characters), separate from contact-only resume basics and item summaries. [Version-7 migration](../src/platform/database/migrations/profile-introduction.ts) adds an empty default without changing historical snapshots. [Profile editing](../src/domain/candidate/candidate.service.ts) preserves omitted introductions and accepts explicit clearing; [import review](../src/platform/profile-import/draft.ts) preserves source wording, ignores missing/blank introductions by default, and only replaces existing text after review.

Each `ProfileItem` owns zero or more independently selectable Facts; each Fact belongs to one Profile and optionally one item in it. `parentItemId` relates items to items. Standalone skills/languages use a null `profileItemId`; fact kind does not determine ownership. `summary` stores background, while responsibilities/achievements remain individual Facts. The [fact service](../src/domain/candidate/fact.service.ts) validates edits and ownership.

[Item validation](../src/domain/candidate/candidate.validation.ts) supports `metadata.startDateText` / `endDateText` (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) and `isCurrent`. Import/manual UI writes day columns only for complete dates, validates ranges and never supplies missing months/days. The new database generation preserves partial-date precision in JSON metadata.

[Explicit import](../src/domain/candidate/import.service.ts) atomically applies submitted contact fields, appends links and inserts items/Facts. The [review selection](../src/pages/profile/import-state.ts) saves all valid, non-ignored content; any non-ignored invalid entry blocks submission and focuses its invalid field. Ignoring a parent excludes its facts. Import allows empty or omitted names, titles, fact content and link labels/URLs; filled values retain format, date-range and length checks. Manual creation still requires a name. [Main sessions](../src/platform/profile-import/service.ts) enforce ownership, draft IDs, parent mappings, consumed entries and identical batch replay receipts. Partial saves retain parents for later facts. Duplicate uploads deliberately create new sessions; replay receipts are memory-only and cleared with the window/session.

Import creates `PROFILE_IMPORT` audit events for each changed record under a shared request/transaction; failure rolls all business rows and success audits back. Session/owner/replay checks precede business dispatch and do not create business audits; accepted transaction failures use ordinary failure audit. [PDF parsing](../src/platform/profile-import/draft.ts) accepts facts with `kind`, optional `content` and optional `tags`; it rejects removed `source.page`/`source.quote` fields and performs no quote matching. Empty optional fields may be omitted; local defaults fill them. Imported facts have empty `evidence`; existing/manual evidence and generated statement-to-Fact links remain supported. PDF bytes, full text, drafts and retry caches stay in memory. AI audit retains its existing startup-only meaning.

## 3. Generation, output and deletion

[Resume requests](../src/domain/resume/resume.service.ts) atomically snapshot the Job, Profile, all Facts and related items. Empty-fact profiles and archived jobs fail. Configuration fixes template/budget and the Server runtime kind; optional provider/model metadata is caller-declared provenance, never authority or credentials. Historical configuration remains readable. [MCP capabilities](mcp-architecture.md#5-job-agent-browser-mcp) serve both internal and external Agents; [Resume reasoning](../src/platform/agent/resume.ts) stays outside the Domain persistence layer.

The [internal prompt](../src/platform/agent/resume.ts) and [external skill](../skills/tailor-resume/SKILL.md) require a supplied introduction to become the summary with only minor local corrections, preserving meaning, wording, emphasis and language. Selection reserves its evidence and budget; conflicts reject at Gate rather than silently rewriting. [Validation](../src/domain/resume/resume.validation.ts) rejects removal of that summary and retains Fact provenance checks. Semantic preservation is a model instruction, not a deterministic guarantee; historical snapshots without the field keep the prior workflow.

The trusted [GenerationService](../src/domain/resume/generation.service.ts) persists `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED / INTERRUPTED`. Internal models receive only read tools; trusted controllers and Codex use shared stage capabilities. Gate rejection persists missing evidence and stops. Publishing creates one Artifact and marks `SUCCEEDED`; output failures preserve publication. Start receipts and stage handlers support identical retries; conflicting submissions fail.

[Runtime leases](../src/platform/database/runtime-leases.ts) renew every 5 seconds and expire after 30 seconds; dead local PIDs are also detected. Startup and background recovery interrupt only unowned/dead-instance work and unmatched audit calls. Repository checks fence expired/foreign generation writes; output claims use unique attempt tokens and separate attempt directories, excluding concurrent edits/builds and fencing file replacement. [The shared output service](../src/platform/resume-output/service.ts) checks the token/content before recording files. UI queries are read-only and poll foreign activity; another session cannot take over an interrupted generation.

[ResumeDocument](../src/domain/resume/resume.types.ts) is the sole draft/polished/Artifact schema: language, application-copied basics and item metadata, summary, experience/projects/education bullets and skills. Each generated statement has a stable UUID, text and nonempty `factIds`. [Validation](../src/domain/resume/resume.validation.ts) enforces unique IDs, selected snapshot references, item ownership, unchanged basics and a language-aware budget; CJK characters count individually. Imported item titles may remain empty in resume documents; metadata must still match the frozen snapshot exactly, without invented placeholders. Polish cannot add statement IDs, items or references to a draft statement. `artifact_facts` is derived from these statements; callers never submit separate provenance. Valid references do not prove semantic truth; [reviewed fixtures](../tests/fixtures/resume-evidence.json) explicitly mark invented metrics and expanded responsibility as unsupported.

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

[Operation receipts](../src/platform/database/operation-receipts.ts) use (operation, request_id), normalized input hash, logical target, first result JSON and creation time. job.import/application.add_note/application.schedule_event write the receipt inside the same Domain transaction as business rows and success audit. Identical retries return the first result across processes/restarts; changed payload or a deleted target conflicts. Receipt result snapshots are retained after target deletion; deletion is not a privacy purge. No automatic recreation or nested service transaction occurs. Resume start keeps its separate same-runtime receipt/lease rule.

[Transactions](../src/platform/database/transactions.ts) and [database triggers](../src/platform/database/migrations/audit-triggers.ts) automatically append audit for every changed business row. Callers supply business parameters only. A write operation owns one internal transaction: all mutations and success audit commit together, or all roll back. Multi-row operations share a request and transaction ID. Ordinary business/audit queries remain read-only; explicit capability reads add access audit below.

| Element | SQL fields | Allowed contents |
| --- | --- | --- |
| What | `event_type`, `action` | Fixed operation name; `CREATE / UPDATE / DELETE` |
| When | `timestamp` | Backend-generated UTC time |
| Where | `component`, `location` | Logical component/operation identifiers |
| Source | `source`, `request_id` | Trusted entry category and generated request UUID |
| Outcome | `status`, `error` | `SUCCESS / FAILURE`; error code only |
| Identity | `actor_id`, `target_type`, `target_id` | Opaque subject and business object identifiers |

Additional fields are `id`, monotonically increasing `sequence` and `transaction_id`. ArtifactFact targets encode their three opaque key IDs as a JSON array string. USER, AI, SYSTEM and EXTERNAL use fixed local identifiers; source is `RENDERER / GENERATOR / STARTUP / AI_CLIENT / MCP_SERVER`. This is a local single-user identity scheme, not multi-user authentication. Public DTO fields use camelCase.

No before/after values, arbitrary metadata, business bodies, prompts, credentials, raw exception messages, stack traces, physical paths or page URLs are retained in audit. An SQL authorizer and triggers reject audit updates/deletions and forged inserts. Business writes without the internal context are rejected. Successful no-op operations with no changed rows create no success record; a generation gate rejection is a successful persistence operation whose run state becomes FAILED.

Failed writes first roll back, then append one failure audit in a separate transaction. The failure retains its request ID; its transaction ID belongs to the failure-audit transaction. A validated target ID is included when known, otherwise null. Invalid business write input is audited without copying input. If failure audit cannot persist, return `AUDIT_UNAVAILABLE`; do not claim it was recorded. Untrusted/unknown IPC requests are rejected before business execution. Settings/secrets use separate file adapters and never place credentials in SQLite or audit.

**Implemented AI call audit:** the Main-internal `recordAI` capability in [Transactions](../src/platform/database/transactions.ts) writes `AI_STREAM_START`, `CREATE`, component `ai`, location `chat.stream`, source `AI_CLIENT` and actor `local-user`. `targetType = ai_request`; target/request IDs are the same generated opaque request UUID, with no business-object mapping. Time, record ID and transaction ID are database-layer generated. [Audit queries](../src/platform/database/audit-reader.ts) accept this logical target without treating it as a business entity/table.

Each accepted request attempts one audit: the first valid SSE chunk commits `SUCCESS` before content is forwarded; startup failure/cancellation commits `FAILURE` with a fixed code. Success means the stream started, not that output completed. Post-start completion, failure and cancellation add no call audit. A manual retry creates a new request. Audit failure stops forwarding/aborts the request and reports `AUDIT_UNAVAILABLE`; the external call may already have occurred. No provider/model/URL, usage, duration, message, prompt, output, business snapshot or extra metadata is persisted. This legacy API remains for connection tests/imports; Ask AI uses the transcript storage below.

**Agent model audit:** every complete or streaming call records one fixed AGENT_MODEL_RESULT outcome through recordAgentModel, with component ai, location agent.model, source GENERATOR and a Main-bound internal Agent label. Only opaque request IDs and fixed outcomes are stored; prompts, outputs, secrets and hidden reasoning are excluded. Audit failure terminates execution.

**Implemented audit browsing:** the read-only [Settings viewer](../src/pages/settings/AuditViewerSection.tsx) uses `audit.list` without schema/IPC changes. It defaults to 25 records per page, ordered by descending sequence. Type/status, exact target/request/transaction IDs and inclusive time boundaries compose existing filters. [Filter conversion](../src/pages/settings/audit-filters.ts) validates IDs/ranges and converts local datetime inputs to canonical UTC; details show localized time plus its stored UTC value. Refresh/reset/filter application restart at page one. Pages use offset pagination; new writes can shift subsequent pages, so refresh to see the latest ordering. No export, automatic polling, log mutation or business-content reconstruction is provided. Settings/key writes remain outside audit; AI success retains its startup-only meaning.

**Implemented capability audit:** [read/write wrappers](../src/platform/tools/capabilities.ts) validate arguments and commit `START` before invoking a Domain service or MCP Client, then commit one `END` with success/fixed error and elapsed time. Tool bindings do not write audit. Native writes reuse the existing business transaction, producing one business change audit per changed row plus a distinct capability access/outcome pair; external network waits never hold a SQLite transaction.

The [controlled-runtime sink](../src/platform/database/capability-audit.ts) writes the append-only `capability_audit` table: invocation ID, phase, UTC timestamp, runtime-bound Agent/run IDs, approved tool name/mode, optional Server/original name, validated native target type/UUID, duration, status and error. It stores no input, output, prompt, URL, command, credential or raw exception. Arguments rejected before execution create no access record. SQL guards and the authorizer reject forged inserts, updates and deletions.

Start-audit failure prevents execution. End-audit failure reports `TOOL_AUDIT_UNAVAILABLE` without retry or rollback claims; an external or committed local write may already have happened. Only unmatched starts owned by dead instances receive an `INTERRUPTED` end; live calls are preserved. The existing `audit.list`/Settings viewer still reads only business/AI `audit_logs`; capability diagnostics remain runtime-internal. [Tests](../tests/capability-audit.test.ts) cover privacy, failure, rollback and immutable records; [MCP architecture](mcp-architecture.md) owns execution policies/lifecycle.

### Ask AI transcript storage

The [Chat repository](../src/platform/database/repositories/chats.ts) atomically creates Session/Run/User Item on first Send, with an input-hashed request UUID receipt. A partial unique index permits one running Run per Session; a composite foreign key binds every Item to its Run/Session. Model choices persist per Session and are copied per Run. New chat drafts stay in Renderer memory. Session deletion cascades transcript rows and receipts, requires no active Run and does not undo business changes or erase audit.

Only the [Main recorder](../src/platform/electron/ask-agent-recorder.ts) appends model/tool Items. It saves visible text, explicitly public reasoning summaries, allowlisted scalar tool summaries and fixed errors; never raw tool arguments/results, system prompts, hidden reasoning, credentials or raw exceptions. Transcript content is separate from content-free audit. Item skeletons precede events; text uses one-second checkpoints and final writes, not per-token SQLite updates. A crash may lose text since the last checkpoint.

Run ownership uses runtime_instances. Recovery interrupts only dead/expired owners; live MCP Server startup cannot interrupt Main work. Active text becomes interrupted and pending tools uncertain. Runs never auto-resume. Event snapshots include the in-memory partial text and monotonic watermark for resubscription. History includes at most 40 completed user/assistant Items and 256 KiB, starting at a user boundary; current-run tool observations are separately bounded at 2 MiB. Tool/reasoning history is not replayed.

[Ask IPC](../src/platform/electron/ask-agent-contract.ts) exposes start/cancel/getRun/listActive/onEvent with trusted-frame and window ownership checks. Manual Chat CRUD uses typed data IPC; Renderer cannot fabricate Runs or output Items. Retry creates a new Run, while a run that attempted writes requires state review rather than automatic replay. [Tests](../tests/chat.test.ts) cover constraints/recovery and [projection tests](../tests/ask-store.test.ts) cover snapshot races/gaps.

## 5. API contract and access

The sandboxed [Preload](../src/platform/electron/preload/index.ts) exposes `window.data`. The complete typed inputs/outputs live in [DataContract](../src/platform/electron/data-contract.ts); field/enumeration definitions remain in the linked Domain types. [Main IPC](../src/platform/electron/main/data-ipc.ts) requires an owned window, its top frame and the exact trusted renderer document. External pages/subframes cannot access data.

Every method accepts one input object and resolves to `{ ok: true, value }` or `{ ok: false, error }`. Implemented business endpoints reject unknown fields, including injected audit/transaction fields. Edit-details methods replace the allowed details, applying documented type defaults; they are not arbitrary patches. Lists use `limit` (default 25, maximum 100) and `offset` (default 0, maximum 1000000), returning `{ items, total }` with stable ordering. Multi-table reads use a consistent read transaction.

Optional detail text and optional URLs default to empty strings, arrays to empty arrays, nullable IDs/dates/salary to null, and item order to 0. Required source/contact-link URLs must use HTTP(S) without credentials. ResumeDocument must contain at least one sourced statement; its budget uses the shared language-aware counter. Exact accepted shapes and limits are enforced by the Domain validation modules.

| Namespace | Implemented responsibility; exact signatures are owned by [DataContract](../src/platform/electron/data-contract.ts) |
| --- | --- |
| `jobs` | Job/company CRUD, source attachment, archive and paginated queries |
| `profiles` | Contact/item/fact CRUD and explicit reviewed import |
| `applications` | Legal status changes, notes, schedules, event/calendar queries |
| `resumes` | Manual Run/Artifact CRUD and provenance queries; Agent stages use MCP |
| `chats` | Session list/get/rename/model/delete, paginated items and runs; no output creation |
| `audit` | Read-only content-free audit browsing |
| `settings`, `secrets` | Validated file preferences and key status/save/delete; never return keys |

The API offers no raw SQL/table CRUD, unrestricted filters, transaction management, audit writer or generation-stage writes. Agent generation stages use MCP, separate from this manual/UI IPC API. IPC mutations are not automatically retried/idempotent; refresh uncertain state before retrying. MCP creation receipts provide the explicit exceptions described in section 4. Use the following fixed codes rather than database messages.

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

[The PDF import bridge](../src/platform/electron/profile-import-contract.ts) exposes `window.profileImport.selectPdf/start/retry/cancel/discard/onEvent`, without path-reading access. Both import `start` operations accept optional `mode` (`single` by default); events include `progress.groups` with states and `queueMs`/`elapsedMs`, and `failed.retryable` indicates cached part retry. PDF `retry({sessionId})` retains the session and returns a new `taskId`. File/network work stays outside synchronous business transactions.

The separate [AI API](../src/shared/ai.ts) retains non-Agent streaming tasks. [Resume IPC](../src/platform/electron/resume-contract.ts) exposes `window.resume.start/getTask/cancel/retryOutput/getPreview/exportPdf/onEvent`; events carry run ID and monotonic sequence, never hidden reasoning. Each window permits one active task; navigation preserves it, window disposal cancels it. Before publication cancel terminates the run; afterward it stops output only. Export opens a system save dialog and copies the existing PDF; `PDF_EXPORT_FAILED` leaves that application copy ready for another save attempt.

[The job import bridge](../src/platform/electron/job-import-contract.ts) exposes `window.jobImport.start/retry/cancel/onEvent`, separately from synchronous business dispatch. Job `retry({taskId})` retains that task ID; both retries require ownership and a failed retryable batch. New read/parse errors remain bridge-only. Each submitted AI part has its own startup audit, while cached successful parts create no new request/audit on retry; content is excluded.

## 6. Settings, secrets and remaining work

Controlled runtimes share `database.sqlite`, its auxiliary files and `userData/artifacts/`. Main owns `userData/settings.json` and `userData/secrets.enc`; the MCP Server does not load application credentials. Electron Session separately owns website cookies/storage. Ordinary business audit cannot be disabled.

The optional Main-only [MCP config](../src/platform/storage/mcp-config.ts) reads version-1 `userData/mcp.json` without creating/resetting it. Configuration contains reviewed stdio executable/arguments and tool manifests; it accepts no environment/credential fields and is excluded from Renderer preferences. MCP credentials/OAuth are planned; do not put secrets in command arguments. The [MCP document](mcp-architecture.md#3-first-party-and-third-party-clients) owns configuration examples and limits.

[Preferences](../src/platform/storage/preferences.ts) validate version 1, English/Simplified Chinese, a `light / dark / system` theme and optional Gmail/Outlook/custom HTTPS webmail without embedded credentials. Existing version-1 light files remain compatible; the version stays 1. Light remains the default. Store the preference (including `system`), not its resolved color scheme; unrelated partial saves preserve it. Apply saved preferences only after successful atomic replacement. Missing files use defaults without writing. Partial saves merge the latest file; malformed/future files fail without resetting. [Atomic replacement](../src/platform/storage/files.ts) uses a private temporary file and rename; failed writes preserve previous data.

[AI preferences](../src/platform/storage/ai-preferences.ts) validate up to 20 named Provider instances, HTTPS endpoints (HTTP only for localhost/loopback), explicit key requirements, up to 100 model IDs each and a nullable global Provider/model default. Optional per-Provider `parallelModels` contains distinct IDs already in that Provider's `models`; omitted/empty means disabled, and invalid writes are rejected atomically. Saving unrelated preferences preserves this list; removing model IDs through Settings removes their opt-ins. Endpoints retain path prefixes but reject credentials, query strings and fragments. Old version-1 files gain missing AI/timeouts defaults in memory without rewriting until Save. Provider removal requires deleting its key first. Discovery, import mode selection and task lifecycle belong to [current architecture](architecture.md).

[Timeout settings](../src/shared/ai.ts) store global `ai.timeouts.requestSeconds`, `pageSeconds` and `modelsSeconds`, defaulting to 120, 20 and 15 seconds. Each is an integer from 1 to 3600; invalid writes preserve the previous file. AI limits cover chat, job/profile parsing and each Resume Agent call; page reading and model detection have independent limits. Provider edits/removal and unrelated preference saves preserve these values. [Settings tests](../tests/settings.test.ts) verify legacy reads, persistence and atomic rejection.

[Secrets](../src/platform/storage/secrets.ts) store version-2 ciphertext maps keyed by Provider instance ID, encrypted by Electron `safeStorage` at [Main composition](../src/platform/electron/main/index.ts). Unavailable encryption (including Linux `basic_text`) refuses saves; deletion remains available. The API returns configuration/encryption status, never decrypted keys. Keys stay outside ordinary preferences, SQLite, snapshots and audit; file preferences/key operations do not append business audit. Version-1 OpenAI ciphertext remains readable and upgrades atomically on the next key write without decrypting unrelated keys. Only the internal AI service can read plaintext through the injected capability; the public bridge returns status. Saving configuration/keys makes no model request; the explicit connection test sends a short prompt to the saved provider/model and can incur charges.

[Settings tests](../tests/settings.test.ts) verify reopen, all theme values, version-1 compatibility, partial-save preservation, validation, corruption, write failures and encrypted-key lifecycle. [Fallback adapters](../src/platform/storage/index.ts) return `NOT_IMPLEMENTED` only when a backend is composed without file services. AI chat uses local fixtures in [AI tests](../tests/ai.test.ts) and [production smoke](../scripts/ai-smoke.cjs); live third-party compatibility and account permissions remain unverified. Strict structured-output negotiation, authenticated page extraction/deduplication, remaining business UI and full privacy purge remain unimplemented. Resume provider compatibility is verified by local fixtures; live providers remain unverified.

- [Current architecture](architecture.md): runtime initialization and process boundaries.
- [Code architecture](code-architecture.md): source ownership and quality checks.
- [Product architecture](product-architecture.md): planned product scope.
- [README](../README.md): validation commands and documentation index.
