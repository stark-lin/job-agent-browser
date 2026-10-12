# Design Brief

Purpose: provide the visual direction and starting point for UI design in Job Agent Browser. Status: **Implemented** light-theme foundations, central UI primitives, Home, Browser, Inbox and Settings presentation; remaining business feature pages are **Scaffolded** and their workflows remain **Planned**. Detailed component rules belong to the [design-system specification](docs/design-system.md).

Language: English · [简体中文](DESIGN.zh-CN.md)

## 1. Visual direction

The workspace should feel calm, readable and focused on the user's next task. Use warm neutral backgrounds, light panels, subtle borders and clear text hierarchy. Keep decoration secondary to content; avoid turning every card or navigation item into a primary action. The current palette and type choices are defined by [canonical tokens](src/shared/ui/design-tokens.json) and expressed in [Home](src/pages/home/HomePage.tsx) and [central styles](src/shared/ui/components.css).

The persistent left sidebar provides direct access to Home and every feature, with one active state. Narrow windows use accessible icon navigation; Inbox remains free of an application top bar. The persistent left sidebar provides direct access to Home and every feature, with one active state. Narrow windows use accessible icon navigation; Inbox remains free of an application top bar. Consistent geometry should make pages feel like one application. Use the shared grid, type baselines and component sizes in the [layout specification](docs/design-system.md#3-layout-geometry-and-typography); do not introduce a separate visual system for a new feature.

Use semantic color to explain an action or outcome, with accompanying text or icons. The [color specification](docs/design-system.md#4-semantic-color-rules) owns the palette and stage mapping; decorative accents must not change those meanings.

## 2. Interaction principles

- Make the next action clear. Keep primary emphasis selective, and label actions by their outcome rather than internal implementation details.
- Preserve location and context. Internal pages and websites belong to the same workspace, while browser controls appear only in Browser; [current architecture](docs/architecture.md#3-presentation-and-interaction) owns the actual navigation behavior.
- Show honest states. A coming-soon page must not imply a working workflow, and reference data must not be presented as a saved user record. Planned flows are owned by [product architecture](docs/product-architecture.md).
- Keep controls usable with a keyboard and at narrow widths. Provide names, focus cues and readable feedback; the [accessibility specification](docs/design-system.md#5-interaction-and-accessibility) owns the acceptance requirements.

## 3. Design authority

| Question | Authoritative reference |
| --- | --- |
| Visual direction and interaction priorities | This document |
| Required dimensions, colors, reuse rules and review process | [Design-system specification](docs/design-system.md) |
| Available application components | [Central public entry](src/shared/ui/index.ts) |
| Actual design values and reusable application appearance | [Tokens](src/shared/ui/design-tokens.json) and [runtime styles](src/shared/ui/components.css) |
| Visual examples and downloadable assets | [Component gallery](docs/components/job-browser-component-library-8px.html) |
| Implemented behavior and remaining limitations | [Current architecture](docs/architecture.md) |

All application UI must compose the central library. Extend it when a primitive or variant is missing; page composition and business handlers remain page-owned. Follow the [mandatory reuse rule](docs/design-system.md#2-mandatory-central-component-reuse) rather than copying gallery markup into a page. The gallery is a reference artifact, not an inventory of implemented React workflows.

## 4. Starting a UI change

Read this brief for direction, then use the detailed specification and public component entry to choose an existing primitive or identify a central extension. Record any new visual decision here only if it changes the application's direction; put component rules in the specification and implementation details in their source files.

Follow the [maintenance and verification process](docs/design-system.md#6-maintenance-and-verification) before delivering the change. Update the relevant document and its translation together. Validation commands and development setup remain in [README](README.md#validation-and-build).

## 5. Related documents

- [Documentation and UI rules](AGENTS.md): ownership and mandatory repository constraints.
- [Code architecture](docs/code-architecture.md): component dependency boundaries and page responsibilities.
- [Design-system specification](docs/design-system.md): detailed rules, sources and verification limits.
