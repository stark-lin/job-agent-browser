# Target Code Architecture

Purpose: define code ownership, dependencies, and gradual migration. Status: Home and layered business storage are **Implemented**; page navigation and other target modules remain **Scaffolded / Planned**. Runtime evidence is recorded in the [current architecture](architecture.md).

Language: English · [简体中文](code-architecture.zh-CN.md)

## 1. Organization and current state

Organize product code by Page, shared business rules by Domain, and technical adapters by Platform. Use a page-first modular architecture without introducing full DDD. Start new features in their page; extract stable cross-page capabilities when needed.

| Layer | Ownership | Existing reference |
| --- | --- | --- |
| App | Composition, routing, providers, navigation, and context | [App placeholder](../src/app/App.tsx) |
| Pages | UI, local components/hooks/state, and page workflows | [Implemented Home](../src/pages/home/HomePage.tsx), [Tailor Resume placeholder](../src/pages/tailor-resume/TailorResumePage.tsx) |
| Domain | Entities, rules, use cases, repository and capability interfaces | [Job use cases](../src/domain/job/job.service.ts) |
| Platform | Electron, browser, database, filesystem, AI, and settings adapters | [SQLite adapter](../src/platform/database/sqlite.ts) |
| Shared | Utilities, types, hooks, and UI without business semantics | [Shared UI placeholder](../src/shared/ui/index.ts) |

The current build still starts in `src/main/`, `src/preload/`, and `src/renderer/`, as specified in [electron.vite.config.ts](../electron.vite.config.ts). Home is imported by [Renderer App](../src/renderer/App.tsx); target entry files are not replacements until migrated.

## 2. Target directory boundaries

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
└── shared/
    ├── ui/
    ├── hooks/
    ├── utils/
    └── types/
```

This target organization exists alongside the original runtime entries. Storage implementations populate its Domain and Platform boundaries. Create page-local components, hooks, and model files only as needed; the [Tailor Resume directory](../src/pages/tailor-resume/) provides placeholders. Home's implementation lives in [its page directory](../src/pages/home/). Unspecified modules use `index.ts` placeholders; file presence is not evidence of functionality.

## 3. Dependencies and process composition

| Consumer | Allowed dependencies | Boundary |
| --- | --- | --- |
| App | Pages, Domain, Platform APIs | Compose and inject dependencies within the correct process |
| Page | Domain, controlled Platform APIs, public UI/utilities | Use navigation/context; never import Main-only implementations |
| Domain | Business interfaces and framework-independent utilities/types | No Page, React, Electron, or concrete Platform dependencies |
| Platform | Domain interfaces, generic contracts, technical libraries | Implement capabilities without knowing product pages |
| Shared | Generic libraries allowed in its runtime | No reverse dependency on business modules; Domain cannot use React UI/hooks |

The logical call flow is Page → Domain → Platform, with Domain depending on interfaces and Platform implementing them. Inject repositories and AI capabilities at application initialization. Cross-process calls use narrow Preload/IPC operations; source folders do not remove Electron process boundaries.

Database access belongs to Main; settings, secret decryption, AI requests and file compilation are also reserved for Main or controlled services. Renderer must not import SQLite, filesystem, or Electron Main implementations. Preserve sandboxing, context isolation, and separation of third-party pages, and validate privileged IPC senders and inputs.

## 4. Navigation and shared context

Navigation belongs in [app/navigation](../src/app/navigation/), outside Domain. It will map internal `app://` pages and HTTP(S) websites to a unified navigation API with validated URL/type pairs. Directory names do not define public URLs: `tailor-resume/` maps to `app://resume`. Internal routing and combined history are still planned.

[app/context](../src/app/context/) should keep references to the current page, Job, and resume Artifact rather than copies of whole records. Resolve Profile and business entities through Domain, and fetch title, content, or selected text through browser capabilities when needed. The earlier example `currentApplicationId` is not a separate persisted entity in the V1 model; Applications uses the Job ID.

Home only invokes navigation to feature entry points. Cross-page rules belong in Domain; navigation and context switching remain App/Page responsibilities.

## 5. Data model and capability placement

The [V1 data architecture](data-architecture.md) owns schemas, pipeline stages, and storage rules. Its five data groups do not require five new source directories. The proposed `main/domains` tree is not a replacement for the existing page-first baseline.

| Responsibility | Placement within the existing boundaries |
| --- | --- |
| Company, Job, sources | `domain/job/`; events and application/calendar use cases live in `domain/application/` |
| Profile, ProfileItem, Fact | `domain/candidate/`, which represents My Profile |
| GenerationRun, Artifact, provenance | Resume use cases in `domain/resume/`; further extraction only when justified by reuse |
| Application lifecycle and calendar | `domain/application/` workflows over Job and JobEvent; UI in `pages/applications/` |
| SQLite, migrations, repositories, audit persistence | Main-side `platform/database/`; audit policy remains a business rule |
| AI provider, settings, encrypted secrets, output files | `platform/ai/`, `platform/storage/`, `platform/filesystem/` adapters; compiler/service files are still to be designed |

Domain defines repository and extraction interfaces; concrete SQLite repositories and [generic extractor](../src/platform/browser/extractors/generic.ts) belong to Platform. Page snapshots are plain data, never Electron or DOM objects. Only the generic extractor is scaffolded; site-specific adapters remain deferred. Validate required Job fields before saving extracted partial data.

AI contracts must not expose a provider SDK's types to pages. Business-specific contracts belong to the consuming Domain; only generic contracts belong in Shared. Concrete providers and compilation adapters remain planned.

`JobCard` and `ResumePreview` stay in Pages even if reused; business types such as `ApplicationStatus` belong in Domain. Shared is not a home for business UI or entities.

## 6. Implementation and quality rules

1. Keep existing build entries active until their replacements work; update [build configuration](../electron.vite.config.ts) and [package entry](../package.json) when migrating them.
2. Add new functionality to its Page, and retain page-only logic there. Avoid creating every possible subfolder in advance.
3. Introduce shared business interfaces when workflows need them; inject Platform implementations without reverse dependencies.
4. Keep public business capabilities in the typed [data contract](../src/platform/electron/data-contract.ts); Platform repositories, transaction contexts and Main-only generation persistence are private implementation details.
5. Preserve the [product entry points](product-architecture.md). Calendar is an Applications view; Resume Builder uses Tailor Resume. Initial Inbox reuses configured webmail, without a new mail database or API adapter.
6. Update owning documents and both language editions with implementation changes. Runtime checks and commands are indexed in the README.

Storage is split into migrations, transaction/audit control, row mapping and per-domain repository adapters. Domain services own validation and business rules; reusable framework-free parsers/errors/ports live in `domain/common/`. Candidate items/facts and resume artifacts/generation are split by responsibility. Comments explain atomicity, privacy, historical references and recovery.

[Quality checks](../scripts/quality.cjs) enforce Domain/Shared/UI dependencies, reject runtime import cycles and `any` in data modules, limit data modules to 250 lines, and check bilingual document links, examples and lengths. TypeScript checks unused declarations/parameters and consistent casing. Integration tests run against Electron SQLite; the smoke test runs built Main/Preload. Commands are owned by README.

Add Product Areas above Pages only when scale requires them; this does not change Domain/Platform boundaries or require full DDD.

## 7. Related documents

- [Product architecture](product-architecture.md): scope, URLs, and feature composition.
- [Current architecture](architecture.md): active entries, behavior, and security checks.
- [V1 data architecture and API](data-architecture.md): implemented storage semantics and public capabilities.
- [README](../README.md): setup, validation, and documentation index.
