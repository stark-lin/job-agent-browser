# Documentation rules

Language: English · [简体中文](AGENTS.zh-CN.md)

Applies to documentation additions and edits in this repository; bring existing documents into compliance when substantially revising them.

## Document ownership

| Document | Owned content |
| --- | --- |
| [README.md](README.md) · [Chinese](README.zh-CN.md) | Overview, quick start, validation commands, and documentation index. |
| [docs/architecture.md](docs/architecture.md) · [Chinese](docs/architecture.zh-CN.md) | Current runtime architecture, implemented behavior, limitations, and source references. |
| [docs/product-architecture.md](docs/product-architecture.md) · [Chinese](docs/product-architecture.zh-CN.md) | Product goals, scope, and delivery sequence, explicitly marked as planned. |
| [docs/code-architecture.md](docs/code-architecture.md) · [Chinese](docs/code-architecture.zh-CN.md) | Target code organization, dependency boundaries, and migration constraints, distinguishing current from target state. |
| [docs/data-architecture.md](docs/data-architecture.md) · [Chinese](docs/data-architecture.zh-CN.md) | Current and planned V1 data model, business data API, generation, provenance, audit, and storage; owns the shared [ER diagram](docs/diagrams/data-model.md). |

Check this table before adding a document; create one only for a distinct topic that does not fit an existing owner, and link it from the README index.

## Separate language files

- English and Chinese must be separate files: `name.md` for English and `name.zh-CN.md` for Simplified Chinese, including `README` and `AGENTS`. Do not mix bilingual paragraphs, headings, or table columns in one file; language-switch links are allowed.
- Each pair must have reciprocal language links, matching section order, equivalent content, and updates in the same change. Add the missing counterpart when substantially revising a monolingual document.
- Preserve paths, commands, and identifiers verbatim. Keep code blocks, directory trees, and diagrams consistent across both editions; link to shared assets when possible.

## Structure and length

- Start with purpose and status, followed by essential content and related links; include only applicable sections and use at most three heading levels.
- Limit each README edition to 120 lines and each topic edition to 200 lines, including blank lines and code blocks. Remove repetition and unnecessary examples before splitting by distinct topic; do not evade limits by merging long paragraphs.

## Alignment with implementation

- Distinguish Implemented, Scaffolded, and Planned content; directories, comments, and example interfaces do not establish implemented functionality.
- Verify current behavior against runtime entries, call paths, configuration, and existing tests, and link relevant source files beside the claims. Use `package.json` for commands and `electron.vite.config.ts` for build entries.
- Update the owning document and its translation in the same change as behavior, interface, directory, or configuration changes. Correct current-state claims that conflict with code; retain planned labels for unmet targets and identify unverified claims.

## Deduplication and review

- Explain each topic in detail only in its owning document; use a one-sentence summary and relative link elsewhere. Translations count as the same topic. Avoid copying full interfaces, directory inventories, setup steps, or product flows; prefer source links for details already expressed in code.
- Before submitting, check language parity, implementation status, valid paths and links, length limits, and duplicate content; run relevant validation and report anything left unverified.
