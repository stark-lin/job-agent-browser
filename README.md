# Job Agent Browser

A local-first desktop workspace for job seeking. Status: **Implemented** unified React App, nine accessible Home entries, per-tab mixed navigation and layered SQLite business backend with automatic audit and typed IPC. Eight feature pages are **Scaffolded**; business workflows, AI execution and compilation remain **Planned**.

Language: English · [简体中文](README.zh-CN.md)

## Quick start

Requires Node.js 22.12 or newer and npm, as declared in [package.json](package.json).

```sh
npm install
npm run dev
```

The `predev` helper downloads the Electron binary on first development launch. All nine Home cards are accessible. Browser opens an empty workspace for URLs, domains or searches; the other eight features show coming-soon pages. Only Browser shows tabs and address controls. Home/new tabs hide browser chrome and internal URLs; Back/Forward traverse internal pages and websites within each tab. See [current architecture](docs/architecture.md) for navigation rules, shortcuts, runtime details and source references.

## Validation and build

Commands are defined in [package.json](package.json):

```sh
npm run check
npm run test:smoke
```

The build writes Main, Preload, and Renderer bundles to `out/`, using [electron.vite.config.ts](electron.vite.config.ts). `check` runs type checking, architecture/document quality checks, Electron SQLite integration tests and build. `test:smoke` requires a graphical desktop and verifies the built window/Preload/IPC, nine entry pages, mixed history and view lifecycle with disposable data. Individual commands are `typecheck`, `quality`, `test`, and `build`. Platform installers remain unconfigured.

For documentation changes, check language parity, implementation labels, relative links, Mermaid consistency, and length limits before reviewing `git diff --check`.

## Documentation index

| Document | Purpose |
| --- | --- |
| [Documentation rules](AGENTS.md) · [简体中文](AGENTS.zh-CN.md) | Ownership, languages, length limits, and review requirements |
| [Current architecture](docs/architecture.md) · [简体中文](docs/architecture.zh-CN.md) | Implemented runtime, security boundaries, and limitations |
| [Product architecture](docs/product-architecture.md) · [简体中文](docs/product-architecture.zh-CN.md) | Planned scope, entry points, and delivery order |
| [Code architecture](docs/code-architecture.md) · [简体中文](docs/code-architecture.zh-CN.md) | Target organization, dependency boundaries, and migration constraints |
| [V1 data architecture and API](docs/data-architecture.md) · [简体中文](docs/data-architecture.zh-CN.md) | Implemented entities, transactions, audit privacy, deletion rules and business API |
| [Shared Mermaid ER diagram](docs/diagrams/data-model.md) | Implemented 11-table model; shared by both data architecture editions |
