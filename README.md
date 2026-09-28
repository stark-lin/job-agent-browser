# Job Agent Browser

Job Agent Browser is a minimal Electron desktop browser foundation. The current phase includes one browser window, a Back/Forward toolbar, a URL and search field, and one persistent Chromium page view. Job Context and Agent features are outside this phase.

## Requirements

- Node.js 22.12 or newer
- npm

## Install and run

```sh
npm install
npm run dev
```

The first development launch downloads the Electron binary for your platform.
Enter a URL or domain in the address bar, or type search terms to search Google. Back and Forward use Chromium's navigation history.

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

## Product and architecture documentation

The product direction is a browser package tailored to job seeking: a unified Browser Shell, a nine-entry Home page, URL-based navigation, and Shared Context. The current implementation is the browser foundation described above; the broader product capabilities are planned.

- [Product architecture baseline](docs/product-architecture.md) — the reference for future design and development ([中文版](docs/product-architecture.zh-CN.md))
- [Code architecture baseline（代码架构基线）](docs/code-architecture.zh-CN.md) — Page-first organization, Domain boundaries, and Platform abstractions for future development
- [Current implementation architecture](docs/architecture.md) — existing process boundaries, navigation rules, and security decisions
