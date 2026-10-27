# Job Agent Browser

A local-first desktop workspace for job seeking. Status: **Implemented** React navigation, Browser/Inbox, Settings, streaming AI, SQLite/audit, Profile editing/PDF import, job capture/applications and Resume Agent V1 with HTML/PDF. Smart Note is **Implemented**; additional product workflows remain **Planned**.

Language: English · [简体中文](README.zh-CN.md)

## Quick start

Requires Node.js 24.10 or newer and npm, as declared in [package.json](package.json).

```sh
npm install -g @stark-lin/jab
jab
jab --version
jab doctor
```

All nine Home cards are accessible. Browser opens an empty workspace for URLs, domains or searches; Settings supports saved language and Light/Dark/Follow system appearance, multiple AI providers, encrypted API keys and mailbox configuration; Ask AI provides persistent multi-session streaming Agent conversations over scoped first-party MCP tools; My Profile manages entries with multiple facts and reviewed PDF imports; Add Job supports manual entry and URL/text/PDF Agent capture, opening Applications after saving as Not started; Applications manages statuses, notes, local events and archive/detail changes through its Agent; other feature pages show coming-soon content when their workflows are unavailable. Only Browser shows tabs and address controls; all features share a left icon sidebar with hover labels and section dividers; configured Inbox displays webmail without an application top bar. The sidebar Home entry replaces the mailbox Exit button. Home/new tabs hide browser chrome and internal URLs; Back/Forward traverse internal pages and websites within each tab. See [current architecture](docs/architecture.md) for navigation rules, shortcuts, runtime details and source references.

Configure an AI provider, credentials and a global default model to capture a job URL/text/PDF, manage an application or import a PDF resume. Save the model’s parallel-import opt-in in Settings to make Parallel selectable at either import entry. Grouping, retries and compact output are explained in [current architecture](docs/architecture.md).

See the [npm user guide](packages/npm/README.md) for full usage, temporary `npx` execution, updating, MCP and local data. Only macOS ARM64 has complete release validation.

## Development

Clone the repository, then run from source:

```sh
npm install
JOB_BROWSER_USER_DATA=/tmp/job-agent-browser-resume-v1 npm run dev
```

The `predev` helper downloads the Electron binary on first development launch.

## Validation and build

Commands are defined in [package.json](package.json):

```sh
npm run check
npm run test:smoke
npm run test:theme
npm run test:jobs
npm run test:mcp
npm run test:mcp-server
npm run test:integrations
npm run test:agent
npm run test:profile
npm run test:ask-ai
```

The build writes Main, MCP Server, output worker, Preload, and Renderer bundles to `out/`, using [electron.vite.config.ts](electron.vite.config.ts). `check` runs type checking, architecture/document quality checks, Electron SQLite integration tests and build. `test:smoke` requires a graphical desktop and verifies the built window/Preload/IPC, nine entry pages, mixed history, view lifecycle, Settings, AI SSE chat, profile editing/PDF import, Add Job/Applications, the global sidebar and Inbox with disposable data. `test:theme` independently verifies themes, color-only geometry and restart recovery without requiring native keyboard focus. `test:jobs` independently verifies job entry, URL/text/PDF capture, application Agent actions, both parallel imports and persistence after process restart. Individual commands are `typecheck`, `quality`, `test`, and `build`. Platform packaging is configured in [electron-builder.yml](electron-builder.yml); verification and release prerequisites are tracked in [CI/CD](docs/ci-cd.md).

`test:mcp` checks the existing MCP Client runtime. `test:mcp-server` checks the public Job/Application/Resume surface, runtime parity and a built Node stdio Server with real Electron HTML/PDF output and disposable storage. Both runtime smokes also run in `check`; Server PDF checks require a graphical desktop. See [MCP architecture](docs/mcp-architecture.md).

`test:integrations` builds and verifies external Agent MCP/Skills setup, reconnection, confirmed selective/all removal, stale revisions, trusted IPC and bilingual responsive themes using disposable configuration directories. It requires a graphical desktop.

`test:agent` combines Agent/provenance/database tests with real Electron UI and multi-page PDF fixtures, using disposable userData and a local compatible model server. `test:profile` separately checks Profile CRUD/import and bilingual layout. Neither requires a paid model. [CI](docs/ci-cd.md) exercises PDF rendering on the macOS arm64 release target; live-provider compatibility and clean-machine behavior beyond CI remain unverified. Resume V1 requires a new database generation; legacy databases are refused without migration or deletion.

`test:ask-ai` checks transcript storage, streaming adapters/loop, real MCP read/write and event resync, then exercises concurrent chats, Stop, drafts, Markdown, bilingual themes, responsive layout and forced-process recovery in Electron. It uses local fixtures and disposable userData; live-provider reasoning/tool compatibility remains unverified. V6 upgrades matching-generation databases additively.

For documentation changes, check language parity, implementation labels, relative links, Mermaid consistency, and length limits before reviewing `git diff --check`.

To connect local Codex, Claude Code or Cursor, open Settings → Connect external Agents → Add MCP, then use Install Skills separately for the six bundled workflows. Other Agents can copy them with Open Skills folder; `npm run skill:link` remains a repository-only alternative. The [MCP connection instructions](docs/mcp-architecture.md#5-job-agent-browser-mcp) own setup and limitations. Codex generation does not require an application AI Provider.

## Packaging and integration

Ordinary `build` stays offline and requires no model. The application manages optional embedding weights in a persistent user store. Full desktop packaging prepares an offline Seed; Minimal desktop and npm packages omit weights. Application license: [AGPL-3.0-only](LICENSE).

```sh
npm run model:prepare
npm run model:verify
npm run test:embedding
npm run test:models
npm run test:release
npm run package:dir
npm run package:mac
npm run package:minimal
npm run package:verify -- /absolute/path/to/unpacked-app
npm run release:npm:check
```

The npm build produces a model-free tarball under `dist/npm-artifacts/` with exact runtime dependencies and a shrinkwrap. [npm user guide](packages/npm/README.md) documents installation and updating of the published package. macOS ARM64 is the only validated release target; clean-user Keychain/Gatekeeper and cross-channel credential compatibility remain unverified. npm defaults to the same JAB data directory as DMG; models persist independently of either installation.

Integrate changes into `dev`, then promote it to `main` through a passing PR. Main builds a Full DMG and npm tarball for the same SHA/version. GitHub publishes first; npm uses OIDC and `latest`; retries of existing versions only check integrity and never change tags. npm scope ownership and Trusted Publisher setup are operator prerequisites. [CI/CD](docs/ci-cd.md) owns signing, release gates and compatibility limits.

## Documentation index

| Document | Purpose |
| --- | --- |
| [Documentation rules](AGENTS.md) · [简体中文](AGENTS.zh-CN.md) | Ownership, languages, length limits, and review requirements |
| [CI/CD](docs/ci-cd.md) · [简体中文](docs/ci-cd.zh-CN.md) | Branch integration, automated validation, packaging, signing and release operations |
| [Current architecture](docs/architecture.md) · [简体中文](docs/architecture.zh-CN.md) | Implemented runtime, security boundaries, and limitations |
| [Product architecture](docs/product-architecture.md) · [简体中文](docs/product-architecture.zh-CN.md) | Planned scope, entry points, and delivery order |
| [Code architecture](docs/code-architecture.md) · [简体中文](docs/code-architecture.zh-CN.md) | Target organization, dependency boundaries, and migration constraints |
| [V1 data architecture and API](docs/data-architecture.md) · [简体中文](docs/data-architecture.zh-CN.md) | Implemented entities, transactions, audit privacy, deletion rules and business API |
| [Tools and MCP runtime](docs/mcp-architecture.md) · [简体中文](docs/mcp-architecture.zh-CN.md) | Scoped tools, audited capability bindings, stdio integration and lifecycle |
| [Capture Job Skill](skills/capture-job/SKILL.md) · [简体中文](skills/capture-job/SKILL.zh-CN.md) | Host source understanding followed by structured MCP persistence |
| [Manage Applications Skill](skills/manage-applications/SKILL.md) · [简体中文](skills/manage-applications/SKILL.zh-CN.md) | State, notes, local events, details and archive workflow |
| [Resume Skill](skills/tailor-resume/SKILL.md) · [简体中文](skills/tailor-resume/SKILL.zh-CN.md) | Codex reasoning workflow over shared Resume tools; setup belongs to MCP architecture |
| [npm user guide](packages/npm/README.md) · [简体中文](packages/npm/README.zh-CN.md) | Published-package commands and user-data behavior |
| [Shared Mermaid ER diagram](docs/diagrams/data-model.md) | Implemented 20-table model; shared by both data architecture editions |
| [Design brief](DESIGN.md) · [简体中文](DESIGN.zh-CN.md) | Visual direction, interaction principles, and starting point for UI design |
| [Component library and design system](docs/design-system.md) · [简体中文](docs/design-system.zh-CN.md) | 8px UI rules, reference HTML, downloadable CSS/Tokens and validation |

## Smart Note knowledge

Smart Note uses one local Markdown tree with Edit/Split/Preview, snapshots, optional GitHub backup and hybrid retrieval. Semantic indexing is enabled by default, while model installation remains optional; Settings provides Download, Repair, Verify, Cancel and confirmed Remove. Missing models retain keyword retrieval. See [knowledge storage](docs/data-architecture.md) and [MCP tools](docs/mcp-architecture.md).
