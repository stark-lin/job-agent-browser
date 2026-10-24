# Job Agent Browser

A local-first desktop workspace for job seeking. Status: **Implemented** React navigation, Browser/Inbox, Settings, streaming AI, SQLite/audit, Profile editing/PDF import, job capture/applications and Resume Agent V1 with HTML/PDF. Interview Prep remains **Scaffolded**; additional product workflows remain **Planned**.

Language: English · [简体中文](README.zh-CN.md)

## Quick start

Requires Node.js 24.10 or newer and npm, as declared in [package.json](package.json).

```sh
npm install
JOB_BROWSER_USER_DATA=/tmp/job-agent-browser-resume-v1 npm run dev
```

The `predev` helper downloads the Electron binary on first development launch. All nine Home cards are accessible. Browser opens an empty workspace for URLs, domains or searches; Settings supports saved language and Light/Dark/Follow system appearance, multiple AI providers, encrypted API keys and mailbox configuration; Ask AI streams chat through the selected provider/model; My Profile manages entries with multiple facts and reviewed PDF imports; Add Job supports manual entry and URL/text/PDF Agent capture, opening Applications after saving as Not started; Applications manages statuses, notes, local events and archive/detail changes through its Agent; other feature pages show coming-soon content when their workflows are unavailable. Only Browser shows tabs and address controls; all features share a left workspace sidebar; configured Inbox displays webmail without an application top bar. The sidebar Home entry replaces the mailbox Exit button. Home/new tabs hide browser chrome and internal URLs; Back/Forward traverse internal pages and websites within each tab. See [current architecture](docs/architecture.md) for navigation rules, shortcuts, runtime details and source references.

Configure an AI provider, credentials and a global default model to capture a job URL/text/PDF, manage an application or import a PDF resume. Save the model’s parallel-import opt-in in Settings to make Parallel selectable at either import entry. Grouping, retries and compact output are explained in [current architecture](docs/architecture.md).

## Validation and build

Commands are defined in [package.json](package.json):

```sh
npm run check
npm run test:smoke
npm run test:theme
npm run test:jobs
npm run test:mcp
npm run test:mcp-server
npm run test:agent
npm run test:profile
```

The build writes Main, MCP Server, output worker, Preload, and Renderer bundles to `out/`, using [electron.vite.config.ts](electron.vite.config.ts). `check` runs type checking, architecture/document quality checks, Electron SQLite integration tests and build. `test:smoke` requires a graphical desktop and verifies the built window/Preload/IPC, nine entry pages, mixed history, view lifecycle, Settings, AI SSE chat, profile editing/PDF import, Add Job/Applications, the global sidebar and Inbox with disposable data. `test:theme` independently verifies themes, color-only geometry and restart recovery without requiring native keyboard focus. `test:jobs` independently verifies job entry, URL/text/PDF capture, application Agent actions, both parallel imports and persistence after process restart. Individual commands are `typecheck`, `quality`, `test`, and `build`. Platform installers remain unconfigured.

`test:mcp` checks the existing MCP Client runtime. `test:mcp-server` checks the public Job/Application/Resume surface, runtime parity and a built Node stdio Server with real Electron HTML/PDF output and disposable storage. Both runtime smokes also run in `check`; Server PDF checks require a graphical desktop. See [MCP architecture](docs/mcp-architecture.md).

`test:agent` combines Agent/provenance/database tests with real Electron UI and multi-page PDF fixtures, using disposable userData and a local compatible model server. `test:profile` separately checks Profile CRUD/import and bilingual layout. Neither requires a paid model. Live-provider compatibility and Windows/Linux PDF rendering remain unverified. Resume V1 requires a new database generation; legacy databases are refused without migration or deletion.

For documentation changes, check language parity, implementation labels, relative links, Mermaid consistency, and length limits before reviewing `git diff --check`.

To use Codex, build the application, run `npm run skill:link`, and connect the stdio entry to the same existing userData directory. The [MCP connection instructions](docs/mcp-architecture.md#5-job-agent-browser-mcp) own configuration; the capture, application-management and Resume Skills own the external reasoning workflows. Codex generation does not require an application AI Provider.

## Documentation index

| Document | Purpose |
| --- | --- |
| [Documentation rules](AGENTS.md) · [简体中文](AGENTS.zh-CN.md) | Ownership, languages, length limits, and review requirements |
| [Current architecture](docs/architecture.md) · [简体中文](docs/architecture.zh-CN.md) | Implemented runtime, security boundaries, and limitations |
| [Product architecture](docs/product-architecture.md) · [简体中文](docs/product-architecture.zh-CN.md) | Planned scope, entry points, and delivery order |
| [Code architecture](docs/code-architecture.md) · [简体中文](docs/code-architecture.zh-CN.md) | Target organization, dependency boundaries, and migration constraints |
| [V1 data architecture and API](docs/data-architecture.md) · [简体中文](docs/data-architecture.zh-CN.md) | Implemented entities, transactions, audit privacy, deletion rules and business API |
| [Tools and MCP runtime](docs/mcp-architecture.md) · [简体中文](docs/mcp-architecture.zh-CN.md) | Scoped tools, audited capability bindings, stdio integration and lifecycle |
| [Capture Job Skill](skills/capture-job/SKILL.md) · [简体中文](skills/capture-job/SKILL.zh-CN.md) | Host source understanding followed by structured MCP persistence |
| [Manage Applications Skill](skills/manage-applications/SKILL.md) · [简体中文](skills/manage-applications/SKILL.zh-CN.md) | State, notes, local events, details and archive workflow |
| [Resume Skill](skills/tailor-resume/SKILL.md) · [简体中文](skills/tailor-resume/SKILL.zh-CN.md) | Codex reasoning workflow over shared Resume tools; setup belongs to MCP architecture |
| [Shared Mermaid ER diagram](docs/diagrams/data-model.md) | Implemented 17-table model; shared by both data architecture editions |
| [Design brief](DESIGN.md) · [简体中文](DESIGN.zh-CN.md) | Visual direction, interaction principles, and starting point for UI design |
| [Component library and design system](docs/design-system.md) · [简体中文](docs/design-system.zh-CN.md) | 8px UI rules, reference HTML, downloadable CSS/Tokens and validation |
