# Tools and MCP Runtime

Purpose: define capability registration, Agent boundaries and MCP integration. Status: **Implemented** four internal Agents, one public Job Agent Browser MCP surface, audited capabilities and third-party stdio consumption. Remote transports remain **Planned**.

Language: English · [简体中文](mcp-architecture.zh-CN.md)

## 1. Ownership and call path

```text
Agent → MCP Client → stdio Server → ToolScope → audited capability → Domain → SQLite
UI    → typed IPC → Domain
```

[AgentTools](../src/shared/agent/index.ts) is an asynchronous discovery/call contract. Its only production implementation is [MCPAgentTools](../src/platform/mcp/first-party-client.ts); no Agent receives ToolScope, Domain services, repositories, backend dispatch or database handles. Source readers and model reasoning are host capabilities outside the business MCP. [Architecture checks](../scripts/quality.cjs) reject direct/indirect privileged dependencies, re-exports, dynamic imports and ToolScope use in Agent modules.

[Main](../src/platform/electron/main/index.ts) owns model configuration, credentials, window ownership and read-only UI projection. UI forms retain typed IPC; Agent-originated saves, workflow submissions, failures, cancellation and output builds cross MCP. Ask AI uses a persistent multi-session streaming Agent runtime over a scoped first-party MCP session; Profile import retains its separate reviewed import workflow.

## 2. Registration and workflow contracts

The sole public composition is [createJobAgentTooling](../src/platform/tools/index.ts). The [Server](../src/platform/mcp-server/server.ts) lists scoped descriptors and delegates calls to server-side ToolScope; registry/policy logic is never an Agent API. [Capabilities](../src/platform/tools/capabilities.ts) own access/execution audit, bounded JSON/schema validation and cancellation. Domain owns business validation and state transitions.

[Registry policies](../src/shared/tools/policy.ts) require an allowlist; deny takes priority, and wildcard syntax is limited to trailing namespace patterns. The public surface caps risk at WRITE. Company writes, SQL, settings, secrets, provider configuration, browser control, email and external actions are absent. New descriptors never silently appear in an existing scope; removed/replaced entries are revoked.

[AgentLoop](../src/platform/agent/loop.ts) permits eight sequential model turns per stage, checks complete assistant call batches, and preserves fixed errors. Cancellation/audit failure terminate immediately. [AgentModel adaptation](../src/platform/ai/agent-model.ts) supports both complete and streaming compatible Chat Completions, maps dotted tool names injectively, and records content-free request outcomes. Model settings and credentials stay in Main.

[Resume](../src/platform/agent/resume.ts) follows score/gate/select/draft/polish; the model sees only immutable snapshot read tools bound to its run. [Capture](../src/platform/agent/capture.ts) reads no JAB tools during interpretation and saves only after review. [Application management](../src/platform/agent/application.ts) reads current Job/state/events before producing a validated action plan; Main binds actions to the selected Job and executes them in order. Missing details trigger a question; partial failures retain completed actions and request IDs.

[Ask Agent](../src/platform/agent/ask.ts) uses the [Pi runtime](../src/platform/agent/pi/runtime.ts). Its initial loadout contains only tool.search/tool.activate; the [catalog](../src/platform/agent/tools/discovery.ts) indexes authorized MCP descriptors and risk metadata, including all five Memory tools. Search returns at most eight summaries; activation defaults to eight tools and an 8%/8,192-token Schema soft budget, subject to the hard context budget. Loadouts change at request boundaries; execution calls MCPAgentTools.call. Validated batches execute sequentially and await every result before the next inference, with a shared 64-request limit per Run, including context summaries; cancellation, audit failure or an uncertain write stops execution.

**Implemented activation guard:** activation preserves activeOnNextRequest and adds alreadyActive/changed/nextAction. Only still-authorized tools verified in the prepared request count as already active; name order/duplicates do not create progress. One redundant activation per normalized group is tolerated; the second ends the Run with AGENT_STEP_LIMIT, stopping later batch tools and inference. Search does not clear counts; successful business calls, effective loadout changes or catalog changes do. Pending same-batch activations and eviction/reactivation are not redundant. [Runtime architecture](architecture.md) owns request verification; [data architecture](data-architecture.md#ask-ai-transcript-storage) owns deletable diagnostics, independently of audit. [Regression tests](../tests/agent-disclosure.test.ts) cover guard and synchronization failures.

The [explicit Ask allowlist](../src/shared/agent/ask-policy.ts) is shared by discovery and the [Server runtime](../src/platform/mcp-server/runtime.ts). Only a redeemed Main-issued Ask launch selects it; caller labels never select permissions. Both tools/list and tools/call exclude all resume.* tools, artifact.build and Delete tools; new tools default to denied. Ordinary Job/Profile/Application and non-delete Knowledge management, five Memory tools and artifact.get remain available. Dedicated Resume sessions and external MCP retain the public workflow surface.

### Ask Run protection

**Implemented:** [openAskRun](../src/platform/mcp/first-party-client.ts) binds each admitted Chat Run to a cancellable view over the reused Session connection. Main registers its identity and issues 30-second one-use `_meta.jabRunGrant` tokens bound to instance, authenticated connection, Run, operation and canonical argument digest. Memory writes also require the existing source grant. Authenticated Ask connections can discover tools without a Run but cannot call them; caller labels never enable protection or permissions. Chat identity never replaces Resume's business runId.

The [Server RunGuard](../src/platform/mcp-server/run-guard/index.ts) runs after authorization and shared capability input preparation, preserving per-tool size limits. A Run lock covers checks, dispatch and outcome registration. Confirmed archive repeats/reversals are rejected before audit/Domain execution. Valid requests, including Guard rejections, count toward 256; call 257 or a second identical violation blocks execution. Uncertain writes retain their original error and stop without retry/rollback. The [Ask AI Cycle state machine](agent-runtime.md) uses trusted snapshots to govern further Pi requests. The MCP Server owns progress detection and capability enforcement.

[Read progress](../src/platform/mcp-server/run-guard/read-progress.ts) tracks cumulative entity/field evidence and per-space file revisions/covered line ranges. Reordered, recombined or subset results and query/score/display changes do not count; new pages, Facts, ranges and revisions do. Empty results count once per dataset. Unknown READ results use canonical structured output or text, preserving unknown fields and array ordering. Read failures count as no progress; known confirmed mutations also contribute progress. Two consecutive no-progress outcomes warn, three enter recovery, and the next business outcome without progress blocks with NO_PROGRESS_LOOP; new evidence clears the streak. Discovery/activation never reset this state.

The [Pi adapter](../src/platform/agent/pi/runtime.ts) attaches fixed warning/recovery guidance separately from unchanged business results and refreshes it in the model system context even after compaction. On recovery, beforeToolCall nonfatally skips the rest of the old batch before tool.started, allowing a fresh model decision. Skipped calls create no execution audit or uncertain write. A blocked Run preserves the successful result that triggered detection, then stops remaining calls/inference. Pre-execution Guard errors are never uncertain writes. Search repetition warns once and stops on the next identical normalized search without progress. Closing revokes grants, aborts work, clears Guard state and awaits a child acknowledgement; failure retires the connection. External MCP remains unguarded; external Run boundaries and third-party outbound guarding remain planned. [Guard tests](../tests/mcp-run-guard.test.ts) and [progress tests](../tests/mcp-run-progress.test.ts) cover these contracts; diagnostics storage belongs to [data architecture](data-architecture.md#ask-ai-transcript-storage).

## 3. First-party and third-party Clients

The [first-party runtime](../src/platform/mcp/first-party-client.ts) lazily reuses real stdio sessions per workflow/per Ask chat. Each admitted Ask turn receives the independent Run-authorized view described above; closed/cancelled views cannot call for later turns. No separate Memory session exists. Electron Node mode launches the built Server with explicit userData. Resume runs retain their original session; lost sessions cannot fall back to local services or take over old runs.

The [Client](../src/platform/mcp/client.ts) accepts processEnv only from trusted composition. Arbitrary environment configuration is not accepted in userData/mcp.json. Internal labels are internal.resume, internal.job-capture, internal.application and internal.ask-ai. [Caller validation](../src/platform/mcp-server/caller.ts) accepts the audit identifier format and falls back to mcp-client. JOB_BROWSER_MCP_CALLER never changes permissions, schemas, tool lists or semantics.

Third-party consumption retains [reviewed configuration](../src/platform/mcp/server-config.ts), [Provider filtering](../src/platform/mcp/provider.ts) and [schema fingerprints](../src/platform/mcp/tool-adapter.ts). Local review owns names, descriptions, schemas and READ/COMPUTE risk; upstream hints cannot grant rights. Missing/changed schemas are quarantined. Schema-change notification revokes the current batch before discovery. There is no implicit reconnect or execution retry.

Missing optional mcp.json does not block the window. Invalid configuration remains untouched with a sanitized diagnostic. Third-party processes use limited SDK environment inheritance and receive no application credentials. These are trusted executables, not an OS sandbox. HTTP/OAuth, MCP resources/prompts, multimodal results and interactive remote input remain planned.

## 4. Bounds, errors and lifecycle

Object inputs use JSON Schema 2020-12 and local references; validation never coerces or drops fields. Getters, cycles, non-JSON values and excessive depth/node counts fail. Defaults remain 64 KiB input/schema, 1 MiB result, 2 MiB transport, depth 32 and 16,384 JSON nodes. Job import/update and score submissions allow 1 MiB input; Resume writing allows 512 KiB. Discovery allows 16 pages/500 tools, with ten-second connect/discovery bounds; one Client permits four concurrent calls and audited capability execution permits sixteen.

Results contain text plus structuredContent. The first-party adapter retains only known fixed Server error codes; malformed/unknown error bodies are sanitized. Third-party errors keep their generic mapping. No prompt, source body, model output, credential or raw process error is persisted in capability audit.

Cancellation notifies the Server and aborts workers; it cannot reverse an already committed write. [Receipts](data-architecture.md#4-audit-and-transactions) make uncertain creation retries safe. Window disposal stops owned work. Shutdown cancels/drains tasks, then closes Clients before Main SQLite; Server EOF aborts work, drains calls/output, retires its lease and closes its connection. Persistent audit failure during uncertain Resume start retires the session so normal recovery can interrupt it.

## 5. Job Agent Browser MCP

The [Node entry](../src/platform/mcp-server/stdio.ts) requires JOB_BROWSER_USER_DATA containing an existing database.sqlite. It never guesses a workspace. Use Node >=24.10 with DatabaseSync.setAuthorizer. [Build entries](../electron.vite.config.ts) produce out/main/job-agent-mcp.js and out/main/resume-output-worker.js; stdout is reserved for MCP messages. The Server does not load AI settings, credentials, models or external MCP Clients.

**Implemented one-click setup:** [Settings](../src/pages/settings/ExternalMCPSettings.tsx) uses separate [typed IPC](../src/shared/external-mcp.ts) and a [Main handler](../src/platform/electron/main/external-mcp-ipc.ts) to configure local Codex, Claude Code and Cursor globally. This human-triggered host operation is absent from business MCP and Agent interfaces. Only the trusted application document/top frame may inspect, install, reconnect, remove, test or copy configuration.

The [configuration adapter](../src/platform/mcp/external-config.ts) writes only `job_agent_browser` in `~/.codex/config.toml` (or `CODEX_HOME/config.toml`), `~/.claude.json` or `~/.cursor/mcp.json`. Unrelated values remain; TOML serialization may change formatting/comments, while JSON edits preserve surrounding text. Matching configurations are no-ops; differing entries require confirmation before replacement. Existing files receive a private original-text `.bak` backup before atomic replacement, with revision checks before writing. Invalid, inaccessible or concurrently changed files are retained; existing file symlinks keep their destination. Custom Claude/Cursor directories and project configuration remain unsupported.

The [installer](../src/platform/mcp/external-install.ts) generates absolute paths from the running application, using Electron in Node mode with `ELECTRON_RUN_AS_NODE`, current `JOB_BROWSER_USER_DATA`, audit-only `JOB_BROWSER_MCP_CALLER` and `JOB_BROWSER_ELECTRON` for output builds. Codex gets a 100-second tool timeout. No Agent CLI is required. Installation and connectivity have separate feedback: testing only connects/discovers tools, then closes its client; window disposal/shutdown aborts pending tests. Reload/restart the target Agent after installation. Other local stdio hosts receive a copyable JSON entry. No credentials from existing configurations are returned or logged; Skills remain separate.

Reconnect atomically republishes the reviewed MCP configuration with a private backup, then verifies a fresh stdio connection; it preserves policy fields and reports configuration success separately from discovery failure. Confirmed removal backs up the file and removes only `job_agent_browser`. Both operations require the inspected revision; removal works without the runtime and cancels pending checks for that target. External Agent processes remain host-owned: users may still need to reload/restart them to retire an old connection.

**Implemented Skills installation:** separate [typed IPC](../src/shared/external-skills.ts) and a [trusted Main handler](../src/platform/electron/main/external-skills-ipc.ts) expose inspection, installation, reconnection, selective removal and opening the bundled directory. The [installer](../src/platform/skills/install.ts) copies complete bilingual folders for the six fixed Skills to Codex `~/.agents/skills`, Claude Code `~/.claude/skills` or Cursor `~/.cursor/skills`; it needs no Agent CLI or network. These user-level paths follow the official [Codex](https://learn.chatgpt.com/docs/build-skills), [Claude Code](https://code.claude.com/docs/en/skills) and [Cursor](https://cursor.com/docs/skills) documentation. The [build](../electron.vite.config.ts) bundles resources under `out/main/skills`, so runtime installation does not depend on the source checkout. Other Agents receive an Open Skills folder action for manual copying.

Inspection reads complete bounded trees without creating files. Matching contents are no-ops; missing folders install directly. Different folders require confirmation, then are replaced **without retained backups**; unrelated Skills survive. Root symlink replacement affects the link only. Temporary staging and revision checks reject changed resources, content or parent directories; failures report completed/pending items and freshly inspected states. Replacement is sequential, not transactional. Skills and MCP setup remain independent; tool use still requires the intended MCP connection. Reload/restart the Agent after installation. Filesystem success does not prove Agent discovery; custom directories, legacy-location migration, cloud installs, automatic updates and Agent enablement changes are unsupported. `CODEX_HOME` changes MCP configuration location, not this Skills destination.

Skills reconnect reinstalls all six bundled folders even when contents match. Confirmed removal accepts only the six fixed Skill names, individually or together; unrelated folders and root symlink targets survive. Revisions reject stale confirmations; failures report the actual deleted and pending names. Deletion removes complete folders, including local edits, without backups. MCP configuration, saved profiles and jobs remain independent. Reload/restart the host to refresh its loaded Skills.

For manual MCP setup, build and configure the host with absolute paths:

```toml
[mcp_servers.job_agent_browser]
command = "/absolute/path/node"
args = ["/absolute/path/job-agent-browser/out/main/job-agent-mcp.js"]
tool_timeout_sec = 100

[mcp_servers.job_agent_browser.env]
JOB_BROWSER_USER_DATA = "/absolute/path/existing-user-data"
JOB_BROWSER_MCP_CALLER = "codex"
```

The following public contracts are available to dedicated workflows and external hosts; authenticated Ask AI receives only its explicit subset above, plus Memory:

| Public capability | Contract |
| --- | --- |
| job.list, job.get, profile.list, profile.get, profile.list_facts, profile.list_items | Saved records, filters and pagination; existing result shapes retained |
| profile.create, profile.update | Structured creation/partial updates with requestId receipts; updates require expectedRevision |
| profile.add_item, profile.update_item, profile.add_fact, profile.update_fact | Same-profile ownership, acyclic parents, partial updates and expectedRevision; all writes have receipts |
| job.import | Structured Job persistence only; requestId receipt, optional genuine web source |
| job.update, job.set_archived | Partial detail changes or archive/restore; identical values do not produce changes |
| application.get, application.set_status | Current state/allowedNextStatuses and Domain-enforced idempotent transitions |
| application.list_events, application.add_note | Paginated timeline; receipt-backed notes also allowed on archived jobs |
| application.schedule_event, application.reschedule_event | Local UTC events; creation receipt, event/Job ownership and archive checks |
| resume.start | Atomic immutable snapshot/start and same-session request UUID receipt; optional declared provider/model metadata |
| resume.get_context, resume.list_facts | Snapshot/progress/documents and paginated facts |
| resume.submit_scores, resume.submit_gate, resume.submit_selection | Ordered stages, identical retry support |
| resume.submit_draft, resume.submit_polished | Validated writing; copied snapshot metadata and derived provenance |
| resume.publish, resume.fail, resume.cancel | Publication or fixed-code failure/cancellation of the owning runtime's run |
| artifact.get, artifact.build | Content/provenance or model-free HTML/PDF output and local paths |

[Profile tools](../src/platform/tools/profile.ts) persist host-understood data without fetching/parsing resumes or repositories. Omitted patch fields are preserved, empty strings/arrays clear, arrays replace, metadata merges by field, and null associations detach. Revision, transaction and receipt rules belong to [data architecture](data-architecture.md#2-business-rules). Profile write input is limited to 256 KiB. Fact inputs/results omit `evidence`; supplying that removed field is rejected as unknown. Distillation Skills save concise facts and tags without source attachments or moving them into other fields.

Resume snapshot bounds remain 1000 facts, 200 items, 256 KiB context and 8 KiB per fact. Reads page at most 100 facts. Conflicting/out-of-order submissions fail. Semantic truth still requires evidence review. Interrupted generation cannot be resumed by another Server session.

[Output lifecycle](../src/platform/resume-output/service.ts) owns managed files and output state; builds use a cancellable [Electron worker](../src/platform/resume-output/worker-client.ts), requiring a graphical environment without a main application window. JOB_BROWSER_ELECTRON may select the Electron binary. Failed output can be rebuilt independently of model calls.

Bilingual [distill-resume](../skills/distill-resume/SKILL.md) extracts profile details, items and sourced facts from resumes; [distill-project](../skills/distill-project/SKILL.md) extracts project/repository evidence, separating documentation, code, observed verification and personal contribution. Both match existing records before using the same MCP writes and ask about material conflicts; a multi-call import is sequential, not atomic as a whole.

Bilingual [capture-job](../skills/capture-job/SKILL.md), [manage-applications](../skills/manage-applications/SKILL.md) and [tailor-resume](../skills/tailor-resume/SKILL.md) are canonical reasoning guides. [skill:link](../scripts/install-skills.cjs) installs all six repository links idempotently and refuses unrelated destinations. Runtime prompts implement the same workflows without loading Skill text as business rules.

## 6. Verification and remaining delivery

[Profile write tests](../tests/profile-writes.test.ts) cover patches, revisions, cross-session receipts, concurrency, ownership, migration and immutable snapshots; [business tool tests](../tests/business-tools.test.ts), [application tests](../tests/application-agent.test.ts), [capture tests](../tests/capture-agent.test.ts), [Resume parity](../tests/resume-runtime-parity.test.ts) and [lease tests](../tests/runtime-leases.test.ts) exercise real stdio, shared SQLite, discovery equality, ownership, concurrent writes, receipts/restart, failures and cancellation. [Server smoke](../scripts/run-mcp-server-smoke.cjs) uses the built entry and real Electron HTML/PDF; [Agent smoke](../scripts/run-agent-smoke.cjs) covers production UI. Commands belong to [README](../README.md).

[Setup tests](../tests/external-mcp.test.ts) cover MCP preservation, backups, conflicts, discovery and cleanup. [Skills tests](../tests/external-skills.test.ts) cover standalone resources, complete-tree equality, idempotence, partial installs/failures, direct replacement, symlinks, permissions and revision rejection. [Settings setup smoke](../scripts/external-mcp-smoke.cjs) includes [Skills smoke](../scripts/external-skills-smoke.cjs) for production IPC/UI, cancel/replace without backups, file parity, errors and reload; the suite checks bilingual responsive themes in disposable Agent directories. [Electron smoke](../scripts/smoke.cjs) rejects untrusted Skills IPC. Live target-Agent discovery/reload and Windows/Linux host compatibility remain unverified.

Real-provider certification, remote transports, external-calendar/email actions and Windows/Linux rendering remain unverified or planned. No test fixture establishes those capabilities.

## Related documents

- [Code architecture](code-architecture.md): dependencies and process boundaries.
- [Data architecture](data-architecture.md): storage, receipts and audit.
- [Current architecture](architecture.md): product runtime and limitations.

## Smart Note knowledge

[Knowledge tools](../src/platform/tools/knowledge.ts) retain knowledge.list/read/search/retrieve/write/mkdir/move/delete and their schemas. The only Memory tools are memory.list/recall/read/write/mkdir; neither namespace accepts space or physical-root arguments. Paths remain space-relative, traversal/symlinks are rejected, and updates require current SHA-256 revisions (null creates only). Memory offers no move/delete/patch. Both namespaces are [native-protected](../src/shared/tools/policy.ts). [Audit migration 10](../src/platform/database/migrations/memory-audit.ts) preserves old rows and extends opaque targets; bodies, queries and credentials are never audited.

[Main launch authority](../src/platform/mcp/memory-authority.ts) authenticates Ask sessions; caller labels never grant rights. One-use launch credentials bind Main instance/session and expire after 30 seconds; the child checks the descriptor/parent PID and retains a revocable control channel. Ask Memory writes additionally require one-use 30-second grants bound to the authenticated session, the current turn's source-message IDs, operation and exact input digest. Grants travel in MCP request metadata, never model schemas/arguments; the Server redeems each grant before dispatch. External MCP and other workflows receive no Memory access.

[Ask AI policy](../src/platform/agent/ask.ts) treats Core, recalled Memory and summaries as untrusted references; Job/Profile/Fact remain authoritative. The sole Pi Agent decides whether to save supported durable information, reads before editing, preserves unrelated content and never stores credentials or claims success before write confirmation. memory.recall defaults to 2,048 approximate retrieval units; memory.read returns TOOL_NOT_FOUND for absent files. The shared [file lock and SHA-256 CAS](../src/platform/knowledge/filesystem.ts) serialize commits across Sessions/processes; reads, model reasoning and Agent conflict reconciliation happen outside the lock. Uncertain outcomes require read-back rather than blind retries. Audit stays content-free; minimal Memory path/revision/outcome references survive context compaction.

The [embedding broker](../src/platform/knowledge/broker.ts) delegates shared query-vector generation to Main; stdio servers load no ONNX and fall back to lexical search offline. [Built-runtime verification](../src/platform/electron/package-verification.ts) checks real MCP retrieval in both isolated indexes with one model process. [Memory MCP tests](../tests/memory-mcp.test.ts) cover permissions/replay/paths/privacy and per-turn grants; [deterministic Agent fixtures](../tests/memory-agent.test.ts) cover ordinary chat, Agent saves, Core refresh, FIFO cancellation, CAS merges and uncertain writes.

[Native session forwarding](../src/platform/mcp/native-environment.ts) carries only selected display and Windows OS fields through stdio launches and generated external configurations so Electron PDF workers can initialize on Linux/Windows; arbitrary user-defined environment overrides remain unsupported.

[npm launch adaptation](../src/platform/npm/distribution.ts) generates absolute Node + `jab.cjs mcp --data-dir` connections for persistent npm installations; ephemeral npx installations cannot install permanent external connections. The CLI requires an explicit absolute data directory or `JOB_BROWSER_USER_DATA`; stdout contains protocol traffic only. Electron PDF output initializes the official runtime when needed. Model management is trusted human IPC only: no MCP tool grants installation, deletion or download permission, and ordinary Agent writes never install a model.
