# Job Agent Browser

Job Agent Browser is a minimal Electron desktop browser foundation. The app opens on a nine-card Home page. The Browser card opens the existing browser with a Home/Back/Forward toolbar, a URL and search field, and one persistent Chromium page view. The other eight cards are reserved for upcoming features. Job Context and Agent features are outside this phase.

## Requirements

- Node.js 22.12 or newer
- npm

## Install and run

```sh
npm install
npm run dev
```

The first development launch downloads the Electron binary for your platform.
Select Browser, then enter a URL or domain in the address bar, or type search terms to search Google. Back and Forward use Chromium's navigation history. Home returns to the nine-card page; reopening Browser preserves the current page and history.

## Build

```sh
npm run typecheck
npm run build
```

`npm run build` compiles the Main, Preload, and Renderer bundles into `out/`. The current project does not yet define platform installers.

## Project structure

- `src/main/` — window lifecycle, persistent web view, navigation, and IPC handlers
- `src/preload/` — narrow Browser API exposed to the trusted UI
- `src/renderer/` — React browser controls
- `src/shared/` — shared browser API and state types
- `docs/` — architecture and development notes

The target architecture is scaffolded alongside the running browser foundation:

- `src/app/` — application composition, navigation, and shared context
- `src/pages/` — Home and the nine feature entry directories
- `src/domain/` — Job, Resume, Candidate, Application, and Interview boundaries
- `src/platform/` — Electron, browser, database, filesystem, storage, and AI adapters
- `src/shared/{ui,hooks,utils,types}/` — public utilities without business semantics

Home is implemented in `src/pages/home/` and used by the current Renderer entry. The remaining scaffold files are placeholders, not implemented features or active build entries.
Named files follow the code architecture examples; otherwise directories have an
`index.ts` entry placeholder. Each placeholder contains one comment describing its
responsibility. Only the generic extractor is scaffolded; site-specific adapters remain
deferred. Existing source files and build entry points remain in place for gradual
migration.

## Product and architecture documentation

Documentation changes follow the [documentation rules](AGENTS.md) ([简体中文](AGENTS.zh-CN.md)).

The product direction is a browser package tailored to job seeking: a unified Browser Shell, a nine-entry Home page, URL-based navigation, and Shared Context. The current implementation is the browser foundation described above; the broader product capabilities are planned.

- [Product architecture baseline](docs/product-architecture.md) — the reference for future design and development ([中文版](docs/product-architecture.zh-CN.md))
- [Code architecture baseline](docs/code-architecture.zh-CN.md) — Page-first organization, Domain boundaries, and Platform abstractions for future development
- [Current implementation architecture](docs/architecture.md) — existing process boundaries, navigation rules, and security decisions
