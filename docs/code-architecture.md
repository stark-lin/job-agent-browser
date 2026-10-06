# Code Architecture

Purpose: define source ownership, dependency boundaries and remaining delivery constraints. Status: React composition/routing, mixed navigation, Platform runtime entries and layered business storage are **Implemented**. Business-page workflows and AI/file integrations remain **Scaffolded / Planned**. Verified behavior is owned by [current architecture](architecture.md).

Language: English · [简体中文](code-architecture.zh-CN.md)

## 1. Organization and active entries

Organize product code by Page, business rules by Domain and technical adapters by Platform. Use page-first modules without full DDD; extract stable cross-page capabilities when needed.

| Layer | Ownership | Existing reference |
| --- | --- | --- |
| App | React composition, routing, providers, navigation projection and context | [App](../src/app/App.tsx), [providers](../src/app/providers.tsx) |
| Pages | UI, local components/hooks/state and page workflows | [Home](../src/pages/home/HomePage.tsx), [Browser](../src/pages/browser/BrowserPage.tsx) |
| Domain | Entities, validation, use cases and capability/repository interfaces | [Job use cases](../src/domain/job/job.service.ts) |
| Platform | Electron, browser, database, filesystem, AI and settings adapters | [Browser manager](../src/platform/browser/browserManager.ts), [SQLite](../src/platform/database/sqlite.ts) |
| Shared | Framework-free contracts and business-free UI/utilities/hooks | [Navigation contract](../src/shared/navigation.ts), [placeholder UI](../src/shared/ui/PlaceholderPage.tsx) |

[Build configuration](../electron.vite.config.ts) now starts Main/Preload in `src/platform/electron/`. `src/renderer/` contains HTML, React mounting, environment types and global styles. The single root lives in `src/app/`; original Main/Preload/Renderer App implementations have been removed. Build output and package entry remain stable.

## 2. Directory boundaries

```text
src/
├── app/
│   ├── navigation/
│   └── context/
├── pages/
│   ├── home/
│   ├── find-jobs/
│   ├── tailor-resume/
│   ├── interview-prep/
│   ├── applications/
│   ├── inbox/
│   ├── profile/
│   ├── browser/
│   ├── ai/
│   └── settings/
├── domain/
│   ├── job/
│   ├── resume/
│   ├── candidate/
│   ├── application/
│   ├── interview/
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
│   ├── storage/
│   └── ai/
├── renderer/
└── shared/
    ├── i18n/
    │   └── locales/
    ├── ui/
    ├── hooks/
    ├── utils/
    └── types/
```

Home and Browser are implemented pages. The other eight page entries render explicit placeholders; page workflows, including Tailor Resume's model/components/hooks, are still scaffolded. Create page-local modules only as needed; directory or file presence does not establish functionality.

## 3. Dependencies and process composition

| Consumer | Allowed dependencies | Boundary |
| --- | --- | --- |
| App | Pages, generic contracts, Domain types and controlled bridges | Compose Renderer services without importing privileged implementations |
| Page | App navigation/providers, Domain types, public UI/utilities | Invoke injected bridge capabilities; never import Main-only implementations |
| Domain | Business interfaces and framework-independent utilities/types | No Page, React, Electron or concrete Platform dependencies |
| Platform | Domain interfaces, generic contracts and technical libraries | Implement capabilities without knowing product pages |
| Shared | Generic libraries allowed in its runtime | No business/Platform/App/Page dependencies; Domain never uses React UI/hooks |

Renderer workflows call typed bridge operations; Main composes Domain services with Platform repositories and transactions. Domain depends on interfaces, with concrete adapters injected by [backend composition](../src/platform/database/backend.ts). The conceptual Page → Domain → Platform flow does not permit importing server services into UI.

Database access remains Main-only. Settings, secrets, AI requests and compilation are reserved for Main or controlled services. Preserve sandboxing, context isolation, third-party page separation and exact trusted-document/top-frame IPC validation.

The [shared i18n module](../src/shared/i18n/) owns framework-independent resources, configuration, selector types and translation initialization; it imports neither React nor Electron. [App](../src/app/i18n.tsx) owns React provider integration and document metadata. Pages translate at render time; Platform translates application-owned native copy. Keep new visible text in the catalog, including complete interpolated sentences, and use typed selectors. Runtime behavior and remaining language support are owned by [current architecture](architecture.md#5-internationalization-preparation).

## 4. Navigation, React state and context

[App navigation](../src/app/navigation/) provides a subscribed projection of Main snapshots and a unified navigation hook. React Context supplies dependencies and `useSyncExternalStore` reads stable snapshots. No routing/state library is added. Provider lifecycle owns subscriptions, initialization races and cleanup; page-local state remains in page hooks/components.

The framework-free [Destination](../src/shared/navigation.ts) contract is shared across processes. [Main browser management](../src/platform/browser/browserManager.ts) owns tabs and authoritative mixed histories; [MixedHistory](../src/platform/browser/mixedHistory.ts) joins internal entries and native-history segments, while [WebSegment](../src/platform/browser/webSegment.ts) owns view events, native traversal and disposal. App routing never changes the trusted document URL.

Browser owns its tab strip/address/controls; other internal pages hide the entire browser bar and all internal URLs. Only Browser acknowledges native presentation, identifying the active tab and target so old acknowledgments cannot cover an internal page. UI URLs and history rules are owned by product architecture; runtime details are owned by current architecture.

[App context](../src/app/context/) holds active-page metadata and nullable Job/Profile/Artifact IDs, not record copies. Resolve entities through the business bridge when workflows are implemented. Applications uses a Job ID, not a separate persisted Application entity. Content/selection capture and automatic context population remain planned.

Home invokes navigation only. Cross-page business rules stay in Domain; navigation and context switching remain App/Page responsibilities.

### Page button ownership

- Each Page owns the buttons it displays, their placement, enabled/loading state and click handlers. App routing and providers supply capabilities without injecting a global Back/Next/Forward button bar.
- Home displays feature entries without a Back button. Other business pages expose Go home as their only page-history navigation button; do not add cross-page Back/Next/Forward controls. Browser owns its existing Home/Back/Forward toolbar.
- Page-local workflow buttons, including step Back/Next when a workflow is implemented, must operate on that page’s state and validation rather than mixed page history. Business actions and links remain page-owned.
- Shared UI may offer presentation and action slots, but must not choose buttons, import navigation hooks or bind history behavior. [PlaceholderPage](../src/shared/ui/PlaceholderPage.tsx) accepts page-provided `actions`; [FindJobsPage](../src/pages/find-jobs/FindJobsPage.tsx) supplies Go home and [InboxPage](../src/pages/inbox/InboxPage.tsx) also owns its Settings action. Use the shared i18n catalog for button labels and accessible names.

## 5. Data and capability placement

[V1 data architecture](data-architecture.md) owns schemas, API, generation stages and storage rules. Its five data groups do not require five new directories or a replacement `main/domains` hierarchy.

| Responsibility | Placement |
| --- | --- |
| Company, Job and sources | `domain/job/` |
| Application lifecycle, events and calendar | `domain/application/`; UI in `pages/applications/` |
| Profile, ProfileItem and Fact | `domain/candidate/`; UI in `pages/profile/` |
| GenerationRun, Artifact and provenance | `domain/resume/`; UI in `pages/tailor-resume/` |
| SQLite, migrations, repositories and audit persistence | Main-side `platform/database/` |
| AI, settings, encrypted secrets and output files | `platform/ai/`, `platform/storage/`, `platform/filesystem/`; implementations remain planned |

Domain defines repository/extraction interfaces. Concrete SQLite repositories and the scaffolded [generic extractor](../src/platform/browser/extractors/generic.ts) belong to Platform. Page snapshots must be plain data, never DOM/Electron objects. Site-specific extraction is deferred; validate required Job fields before saving partial data.

AI contracts must not expose provider SDK types to pages. Business-specific contracts belong to the consuming Domain; generic contracts belong in Shared. Business UI such as ResumePreview stays in Pages even if reused. Shared placeholder layout has no business semantics.

## 6. Quality and future delivery

[Quality checks](../scripts/quality.cjs) enforce App/Page/Renderer privileged-import boundaries, Domain/Shared dependencies, runtime import cycles, data-boundary types/module lengths and bilingual document parity/links/lengths. TypeScript checks unused declarations/parameters and casing. Pure navigation/store tests complement Electron SQLite integration and production-window smoke. Commands are owned by README.

Keep business capabilities in [DataContract](../src/platform/electron/data-contract.ts); repositories, transaction contexts, audit writers and generation-stage persistence remain private. Storage modules separate migrations, transaction/audit control, mapping and domain adapters; Domain services own business validation.

Calendar remains an Applications view; Resume Builder belongs to Tailor Resume. Initial Inbox will reuse configured webmail without a mail database. AI execution, compilation, settings/secrets persistence and business forms are future work, not completed by accessible page skeletons. History restoration/eviction is also deferred.

Update the owning document and both language editions with behavior, interface, directory or configuration changes. Preserve build output, SQLite/audit behavior and Session partition during future migrations. Add Product Areas only when scale requires them; full DDD remains unnecessary.

## 7. Related documents

- [Product architecture](product-architecture.md): product rules and feature composition.
- [Current architecture](architecture.md): runtime, behavior and security.
- [V1 data architecture and API](data-architecture.md): persistence semantics and capabilities.
- [README](../README.md): setup, validation and documentation index.
