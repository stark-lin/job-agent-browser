# Job Agent Browser

A local-first desktop workspace for job seeking. Status: **Implemented** browser foundation and nine-card Home; **Scaffolded** business modules; **Planned** job management, profile facts, resume generation, and the V1 data model.

Language: English · [简体中文](README.zh-CN.md)

## Quick start

Requires Node.js 22.12 or newer and npm, as declared in [package.json](package.json).

```sh
npm install
npm run dev
```

The `predev` helper downloads the Electron binary on first development launch. Select Browser on Home, then enter a URL, domain, or search terms. Back and Forward use Chromium history; Home hides the page, and reopening Browser preserves its page and history. The other eight cards are disabled. See [current architecture](docs/architecture.md) for runtime details and source references.

## Validation and build

Commands are defined in [package.json](package.json):

```sh
npm run typecheck
npm run build
```

The build writes Main, Preload, and Renderer bundles to `out/`, using [electron.vite.config.ts](electron.vite.config.ts). There is no configured test command or platform installer. A successful build does not verify planned product features.

For documentation changes, check language parity, implementation labels, relative links, Mermaid consistency, and length limits before reviewing `git diff --check`.

## Documentation index

| Document | Purpose |
| --- | --- |
| [Documentation rules](AGENTS.md) · [简体中文](AGENTS.zh-CN.md) | Ownership, languages, length limits, and review requirements |
| [Current architecture](docs/architecture.md) · [简体中文](docs/architecture.zh-CN.md) | Implemented runtime, security boundaries, and limitations |
| [Product architecture](docs/product-architecture.md) · [简体中文](docs/product-architecture.zh-CN.md) | Planned scope, entry points, and delivery order |
| [Code architecture](docs/code-architecture.md) · [简体中文](docs/code-architecture.zh-CN.md) | Target organization, dependency boundaries, and migration constraints |
| [V1 data architecture](docs/data-architecture.md) · [简体中文](docs/data-architecture.zh-CN.md) | Planned entities, generation, provenance, audit, and storage |
| [Shared Mermaid ER diagram](docs/diagrams/data-model.md) | Complete planned 11-table model; shared by both data architecture editions |
