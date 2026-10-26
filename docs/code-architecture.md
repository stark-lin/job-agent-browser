# Code Architecture

Purpose: define source ownership, dependency boundaries and delivery constraints. Status: **Implemented** App/router, mixed navigation, Platform entries, chat/AI, layered storage, Profile workflows, Job Capture/Application Agents and Resume Agent V1 with HTML/PDF. Smart Note is **Implemented**; additional workflows are **Planned**. Verified behavior belongs to [current architecture](architecture.md).

Language: English · [简体中文](code-architecture.zh-CN.md)

## 1. Organization and active entries

Organize product code by Page, business rules by Domain and technical adapters by Platform. Use page-first modules without full DDD; extract stable cross-page capabilities when needed.

| Layer | Ownership | Existing reference |
| --- | --- | --- |
| App | React composition, routing, providers, navigation projection and context | [App](../src/app/App.tsx), [providers](../src/app/providers.tsx), [theme projection](../src/app/theme.tsx) |
| Pages | UI, local components/hooks/state and page workflows | [Home](../src/pages/home/HomePage.tsx), [Browser](../src/pages/browser/BrowserPage.tsx) |
| Domain | Entities, validation, use cases and capability/repository interfaces | [Job use cases](../src/domain/job/job.service.ts) |
| Platform | Electron, browser, database, filesystem, AI and settings adapters | [Browser manager](../src/platform/browser/browserManager.ts), [SQLite](../src/platform/database/sqlite.ts) |
| Shared | Framework-free contracts and business-free UI/utilities/hooks | [Navigation contract](../src/shared/navigation.ts), [placeholder UI](../src/shared/ui/PlaceholderPage.tsx) |

[Build configuration](../electron.vite.config.ts) now starts Main/Preload in `src/platform/electron/`. `src/renderer/` contains HTML, React mounting, environment types and global styles. The single root lives in `src/app/`; original Main/Preload/Renderer App implementations have been removed. The package entry remains `out/main/index.js`; additional Node MCP and Electron output-worker entries are built alongside it.

All UI components must compose primitives from the [central library entry](../src/shared/ui/index.ts); add missing variants centrally before page use. Pages keep layout and event behavior. The [design specification](design-system.md#2-mandatory-central-component-reuse) owns the full reuse rule.

Shared UI also owns [canonical design tokens](../src/shared/ui/design-tokens.json), [dark color overrides](../src/shared/ui/design-tokens.dark.json), generated CSS/native colors/geometry and reference component styles; Renderer/Page styles consume them. The [design specification](design-system.md) owns visual rules, assets and regeneration.

## 2. Directory boundaries

```text
src/
├── app/
│   ├── ai/
│   ├── navigation/
│   └── context/
├── pages/
│   ├── home/
│   ├── find-jobs/
│   ├── tailor-resume/
│   ├── knowledge/
│   ├── applications/
│   ├── inbox/
│   ├── profile/
│   ├── browser/
│   ├── ai/
│   └── settings/
├── domain/
│   ├── job/
│   ├── resume/
│   ├── chat/
│   ├── candidate/
│   ├── application/
│   ├── knowledge/
│   └── common/
├── platform/
│   ├── electron/
│   │   ├── main/
│   │   └── preload/
│   ├── browser/
│   │   └── extractors/
│   ├── database/
│   │   ├── migrations/
│   │   └── repositories/
│   ├── filesystem/
│   ├── import/
│   ├── profile-import/
│   ├── job-import/
│   ├── storage/
│   ├── ai/
│   ├── mcp/
│   ├── mcp-server/
│   ├── agent/
│   ├── resume-output/
│   └── tools/
├── renderer/
└── shared/
    ├── i18n/
    │   └── locales/
    ├── ui/
    ├── hooks/
    ├── utils/
    ├── types/
    └── tools/
```

Home, Browser, Inbox, Ask AI, Profile, Settings, Add Job, Applications and Tailor Resume are implemented. Smart Note is implemented. Local modules are created only when used; files/directories alone do not establish behavior.

## 3. Dependencies and process composition

| Consumer | Allowed dependencies | Boundary |
| --- | --- | --- |
| App | Pages, generic contracts, Domain types and controlled bridges | Compose Renderer services without importing privileged implementations |
| Page | App navigation/providers, Domain types/pure validation, public UI/utilities | Invoke injected bridge capabilities; never import Main-only implementations |
| Domain | Domain contracts/utilities and type-only imports from `shared/tools/index.ts` | No Page, React, Electron, Registry implementation or concrete Platform dependencies |
| Platform | Domain interfaces, generic contracts and technical libraries | Implement capabilities without knowing product pages |
| Shared | Generic libraries allowed in its runtime | No business/Platform/App/Page dependencies; Domain never uses React UI/hooks |

Renderer workflows call typed bridge operations; Main composes Domain services with Platform repositories and transactions. Domain depends on interfaces, with concrete adapters injected by [backend composition](../src/platform/database/backend.ts). The conceptual Page → Domain → Platform flow does not permit importing server services into UI.

Database access remains inside controlled Main/Node runtimes. Settings, secrets, AI requests and compilation are reserved for Main or controlled services. Preserve sandboxing, context isolation, third-party page separation and exact trusted-document/top-frame IPC validation.

The [shared i18n module](../src/shared/i18n/) owns framework-independent resources, configuration, selector types and translation initialization; it imports neither React nor Electron. [App](../src/app/i18n.tsx) owns React provider integration and document metadata. Pages translate at render time; Platform translates application-owned native copy. Keep new visible text in the catalog, including complete interpolated sentences, and use typed selectors. Runtime behavior and remaining language support are owned by [current architecture](architecture.md#5-internationalization).

## 4. Navigation, React state and context

[App navigation](../src/app/navigation/) provides a subscribed projection of Main snapshots and a unified navigation hook. React Context supplies dependencies and `useSyncExternalStore` reads stable snapshots. No routing/state library is added. Provider lifecycle owns subscriptions, initialization races and cleanup; page-local state remains in page hooks/components.

The framework-free [Destination](../src/shared/navigation.ts) contract is shared across processes. [Main browser management](../src/platform/browser/browserManager.ts) owns tabs and authoritative mixed histories; [MixedHistory](../src/platform/browser/mixedHistory.ts) joins internal entries and native-history segments, while [WebSegment](../src/platform/browser/webSegment.ts) owns view events, native traversal and disposal. App routing never changes the trusted document URL.

Browser owns its tab strip/address/controls; other internal pages hide the entire browser bar and all internal URLs. Browser and Inbox acknowledge their own native surfaces through the [presentation hook](../src/app/navigation/useNativePresentation.ts), identifying the active tab and target so old acknowledgments cannot cover another page. Inbox never renders Browser controls. UI URLs and history rules are owned by product architecture; runtime details are owned by current architecture.

[App context](../src/app/context/) holds active-page metadata and nullable Job/Profile/Artifact IDs, not record copies. Resolve entities through the business bridge. Applications uses a Job ID, not a separate persisted Application entity. Profile resolves and updates its current Profile ID; saving Add Job and selecting Applications details update the Job ID. Tailor Resume populates the Artifact ID; automatic page content/selection capture remains planned.

Home invokes navigation only. Cross-page business rules stay in Domain; navigation and context switching remain App/Page responsibilities.

### Page button ownership

- App owns the persistent workspace sidebar and feature navigation metadata; Pages own their workflow buttons, placement, enabled/loading state and handlers. The sidebar uses the same navigation API and leave guard, without a global Back/Next/Forward bar.
- Home displays feature entries without a Back button. Other business pages expose Go home as their only page-history navigation button (Ask AI V2 uses the persistent Home sidebar entry); do not add cross-page Back/Next/Forward controls. Browser owns its existing Home/Back/Forward toolbar.
- Page-local workflow buttons, including step Back/Next when a workflow is implemented, must operate on that page’s state and validation rather than mixed page history. Business actions and links remain page-owned.
- Shared UI may offer presentation and action slots, but must not choose buttons, import navigation hooks or bind history behavior. [PlaceholderPage](../src/shared/ui/PlaceholderPage.tsx) accepts page-provided `actions`; [AddJobPage](../src/pages/find-jobs/AddJobPage.tsx) owns job creation and Go home and [InboxPage](../src/pages/inbox/InboxPage.tsx) also owns its Settings action. Use the shared i18n catalog for button labels and accessible names.

## 5. Data and capability placement

[V1 data architecture](data-architecture.md) owns schemas, API, generation stages and storage rules. Its five data groups do not require five new directories or a replacement `main/domains` hierarchy.

| Responsibility | Placement |
| --- | --- |
| Company, Job and sources | `domain/job/` |
| Application lifecycle, events and calendar | `domain/application/`; UI in `pages/applications/` |
| Profile, ProfileItem and Fact | `domain/candidate/`; UI in `pages/profile/` |
| GenerationRun, Artifact and provenance | `domain/resume/`; UI in `pages/tailor-resume/` |
| SQLite, migrations, repositories and audit persistence | Main-side `platform/database/` |
| AI, settings, encrypted secrets and output files | `platform/ai/`, `platform/storage/`, `platform/filesystem/`; AI chat/settings/secrets are implemented; Resume generation/output live in `platform/agent/` and `platform/resume-output/` |

Domain defines repository and [snapshot reader/extractor interfaces](../src/domain/job/job.extractor.ts). The [URL reader](../src/platform/job-import/url-reader.ts), HTML parsing and AI extraction belong to `platform/job-import/`; future Browser adapters share the same plain-data snapshot, never DOM/Electron objects. Pages coordinate tasks through the [asynchronous bridge](../src/platform/electron/job-import-contract.ts); database methods still handle only confirmed saves.

The [Shared AI contract](../src/shared/ai.ts) exposes provider-independent types. [Platform AI](../src/platform/ai/) owns protocol adaptation, credential/configuration resolution, SSE, cancellation, timeout and the injected database audit capability; Main composes it without putting network waits inside database transactions. [AI Preload](../src/platform/electron/preload/ai-bridge.ts) is separate from synchronous DataContract dispatch. Pages only coordinate input and presentation. AI contracts must not expose provider SDK types to pages. Business-specific contracts belong to the consuming Domain; generic contracts belong in Shared. Business UI such as ResumePreview stays in Pages even if reused. Shared placeholder layout has no business semantics.

[Shared Agent contracts](../src/shared/agent/index.ts) own AgentModel/AgentTools. [Platform Tools](../src/platform/tools/index.ts) is the sole public MCP registry; ToolScope is Server-only. Only platform/mcp and platform/mcp-server import the MCP SDK. Agent modules may import pure Domain workflow/validation, but never services, repositories, registries or database adapters, including indirectly. [MCP architecture](mcp-architecture.md) owns capabilities and session behavior.

[Chat Domain](../src/domain/chat/) owns pure transcript contracts and manual CRUD validation. [Main Ask tasks](../src/platform/electron/ask-agent-tasks.ts) own Run lifecycle and inject the private SQLite recorder; [AskStore](../src/app/ai/askStore.ts) owns App-lifetime event projection, while Pages compose central controls. Agent code receives only models, MCP tools and a pure event callback; it never imports transcript repositories. Streaming protocol/framing stays under platform/ai and the tool/model state machine under platform/agent.

[Profile](../src/pages/profile/ProfilePage.tsx) owns forms, grouped facts and editable import drafts. Candidate Domain owns [atomic import](../src/domain/candidate/import.service.ts); [Platform import](../src/platform/profile-import/service.ts) owns Worker extraction, AI orchestration, session ownership and replay receipts; [shared import infrastructure](../src/platform/import/batch.ts) owns bounded batches, cancellation and successful-result caching, while [policy](../src/platform/import/policy.ts) checks mode permission in Main. Each import adapter retains its own prompts, field validation and merging rules. Business DTOs belong to Candidate and [typed IPC](../src/platform/electron/profile-import-contract.ts); generic channel names and [mode/group progress types](../src/shared/import.ts) live in Shared.

Add Job and Profile reuse the App-owned [unsaved guard](../src/app/navigation/useUnsavedGuard.ts); job forms, empty-field filling and Applications querying remain page-owned.

[Platform Agents](../src/platform/agent/) implement Resume five-stage reasoning, source capture and application action planning through AgentTools. Domain retains machine-enforced workflow contracts; prompts belong to Agent adapters. Main task services under platform/electron own window lifecycle, typed IPC and UI projection; model adapters under platform/ai own provider access. The Node MCP Server owns business capabilities and Electron output-worker builds. UI preview/export do not become Agent capability shortcuts.

## 6. Quality and future delivery

[Quality checks](../scripts/quality.cjs) enforce App/Page/Renderer privileged-import boundaries, Domain/Shared dependencies, runtime import cycles, data-boundary types/module lengths and bilingual document parity/links/lengths. TypeScript checks unused declarations/parameters and casing. Pure navigation/store tests complement Electron SQLite integration and production-window smoke. Commands are owned by README.

Keep business capabilities in [DataContract](../src/platform/electron/data-contract.ts); repositories, transaction contexts, audit writers and generation-stage persistence remain private. Storage modules separate migrations, transaction/audit control, mapping and domain adapters; Domain services own business validation.

Calendar remains an Applications view; Resume Builder belongs to Tailor Resume. Inbox reuses configured webmail without a mail database. Remaining business forms are future work, not completed by accessible page skeletons. History restoration/eviction is also deferred.

Update the owning document and both language editions with behavior, interface, directory or configuration changes. Preserve build output, SQLite/audit behavior and Session partition during future migrations. Add Product Areas only when scale requires them; full DDD remains unnecessary.

## 7. Related documents

- [Product architecture](product-architecture.md): product rules and feature composition.
- [Current architecture](architecture.md): runtime, behavior and security.
- [V1 data architecture and API](data-architecture.md): persistence semantics and capabilities.
- [README](../README.md): setup, validation and documentation index.

## Smart Note knowledge

[Domain knowledge](../src/domain/knowledge/index.ts) owns types and pure validation. [Platform knowledge](../src/platform/knowledge/service.ts) owns filesystem/Git/SQLite/network adapters; [pages/knowledge](../src/pages/knowledge/KnowledgePage.tsx) calls only the typed bridge. Agent code never imports this service: every knowledge operation crosses MCP.

[Embedding contracts](../src/platform/knowledge/rag/embedding.ts) and the scheduler remain independent of Electron; [model-path](../src/platform/knowledge/rag/model-path.ts) binds the Electron utility transport. The inference entry owns only model/tokenizer/runtime. [Build configuration](../electron.vite.config.ts) emits embedding-process.js alongside Main/MCP/output worker; packaging externalizes native dependencies. Distribution operations belong to [CI/CD](ci-cd.md).
