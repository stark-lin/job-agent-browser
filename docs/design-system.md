# Component Library and Design System

Purpose: define enforceable component rules and the maintenance process. Status: **Implemented** tokens, CSS reference gallery, central React primitives and their use by Home, Browser, Inbox, Settings and placeholder pages. Remaining business feature pages are **Scaffolded**; business workflows and React equivalents for the remaining gallery examples are **Planned**. Visual direction belongs to [DESIGN.md](../DESIGN.md).

Language: English · [简体中文](design-system.zh-CN.md)

## 1. Sources and reference assets

| Responsibility | Source of truth |
| --- | --- |
| Token values | [design-tokens.json](../src/shared/ui/design-tokens.json) |
| Public React components | [Central entry](../src/shared/ui/index.ts) |
| Shared application appearance | [components.css](../src/shared/ui/components.css) |
| Reference examples and their presentation | [Gallery HTML](components/job-browser-component-library-8px.html) and [component-library.css](../src/shared/ui/component-library.css) |
| Generated exports | [Tokens CSS](../src/shared/ui/design-tokens.css), [native geometry](../src/shared/ui/geometry.ts), [sidebar responsive CSS](../src/shared/ui/sidebar-responsive.css), [standalone reference CSS](components/job-browser-component-library-8px.css) |

The [Renderer entry](../src/renderer/main.tsx) imports `components.css`, which imports generated tokens. The gallery loads the standalone reference CSS and provides downloads for that CSS, Tokens CSS and Tokens JSON. Save its HTML and standalone CSS together for offline viewing; no build or external fonts are required. Tokens JSON is a flat map of CSS values, not a DTCG schema.

The gallery retains ten categories: Foundations, Buttons, Forms, Navigation, Badges & chips, Cards, Job components, Feedback, Overlays and Tables. It includes spacing rulers and size examples. Sample jobs, actions and secrets guidance are reference content, not proof of application functionality.

Application and gallery styles are separate sources sharing the same tokens. The generator does not turn gallery examples into React components or synchronize their appearance with runtime components automatically; update both sources when a common visual rule changes.

## 2. Mandatory central component reuse

All application UI components must use `src/shared/ui/index.ts` (or its directory import). Page and feature-specific UI compose these primitives; structural elements such as `main`, `section`, `div`, `span` and `form` are allowed. Using tokens alone does not satisfy the reuse rule. Pure business Domain modules must remain UI-free, as required by [code architecture](code-architecture.md).

| Implemented component | Supported use | Implementation |
| --- | --- | --- |
| `Button`, `IconButton` | Action, icon and browser-tab variants; callers supply labels and handlers | [Button.tsx](../src/shared/ui/Button.tsx) |
| `TextInput` | Default field or bare input inside a styled wrapper | [TextInput.tsx](../src/shared/ui/TextInput.tsx) |
| `Glyph` | Shared named SVG symbols used by Home and workspace navigation | [Glyph.tsx](../src/shared/ui/Glyph.tsx) |
| `Sidebar`, `NavigationGroup`, `NavigationItem` | Generic sidebar composition, group headings and named native buttons with current-page state | [Sidebar.tsx](../src/shared/ui/Sidebar.tsx) |
| `Icon`, `IconBox` | SVG glyph and neutral/primary icon container | [Icon.tsx](../src/shared/ui/Icon.tsx) |
| `FeatureCard` | Feature entry with icon, label and description | [FeatureCard.tsx](../src/shared/ui/FeatureCard.tsx) |
| `FormField`, `Select` | Associated labels, help/errors and native selection | [Form.tsx](../src/shared/ui/Form.tsx) |
| `SectionCard`, `PageHeading` | Shared panel and page heading presentation | [Form.tsx](../src/shared/ui/Form.tsx) |
| `StatusMessage` | Neutral, information, success and error feedback | [Form.tsx](../src/shared/ui/Form.tsx) |
| `Dialog` | Native modal focus containment; page-owned actions and cancellation | [Dialog.tsx](../src/shared/ui/Dialog.tsx) |
| `PlaceholderPage` | Explicit coming-soon layout with page-provided actions | [PlaceholderPage.tsx](../src/shared/ui/PlaceholderPage.tsx) |

- Add missing primitives or variants to `src/shared/ui/` and export them centrally before page use. Gallery-only forms, badges, job cards, feedback, dialogs and tables still need central React implementations where not represented by the existing primitives.
- Keep reusable appearance, sizes, visual states and accessibility defaults in the central library. Page CSS may arrange components with shared tokens; it must not duplicate control styles, redefine `.ui-*` selectors or bypass the library with inline styles.
- Pages own placement, business data, enabled/loading state, navigation and event handlers. Shared UI accepts props and composition slots; it must not import App/Page/Domain/Platform behavior. A `className` is for composition, not a second component skin.

[HomeTile](../src/pages/home/HomeTile.tsx), [Browser controls](../src/pages/browser/BrowserControls.tsx), [AddressBar](../src/pages/browser/AddressBar.tsx) and [FindJobsPage](../src/pages/find-jobs/FindJobsPage.tsx) and [SettingsPage](../src/pages/settings/SettingsPage.tsx) show current consumption. Do not copy gallery markup into a page or import a private implementation file instead of the public entry.

## 3. Layout, geometry and typography

| Item | Required scale or size | Tokens |
| --- | --- | --- |
| Spacing | 0 / 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px | `--space-*` |
| Controls | Small 32px / default 40px / large 48px | `--control-sm`, `--control-md`, `--control-lg` |
| Toolbar | 48px | `--toolbar-height` |
| Browser tab strip / total chrome | 48px / 96px | `--tab-strip-height`, `--browser-chrome-height` |
| Workspace sidebar | 208px wide above 960px; 64px icon rail at or below 960px; 40px minimum navigation items | `--sidebar-width`, `--sidebar-compact-width`, `--sidebar-breakpoint`, `--control-md` |
| List row | 64px minimum; grow for content when necessary | `--list-row-height` |
| Home card | 144px minimum at every viewport size | `--feature-card-height` |
| Icon / container | 16px / 32px or 40px | `--icon-size`, `--icon-box`, `--icon-box-lg` |
| Corners | 8 / 16 / 24px | `--radius-*` |
| Font sizes | 12 / 14 / 16 / 20 / 32 / 40px | `--font-*` |
| Line heights | 16 / 24 / 32 / 40 / 48px | `--line-*` |
| Borders / focus outline | 1px / 2px | `--border-width`, `--focus-width` |

All nonzero padding, gap and margin must use spacing tokens. Zero and automatic margins are allowed. Percentages, flexible tracks and `min()` are for fluid dimensions, not arbitrary spacing. `--space-N` counts 8px steps; unlisted steps such as 56px are excluded. Do not use viewport-based padding or continuously scaled font sizes in place of the defined scales.

Font sizes and stroke widths are grid exceptions. Circular dots and loading indicators use `50%` rounding; rectangular controls, chips and badges use the corner scale. SVG paths and glyph strokes are not layout measurements. Fluid rendered widths need not be divisible by eight.

Use grid/flex alignment to center icons, fixed token line heights for text, and `box-sizing: border-box` for borders. Let labels/descriptions wrap and retain minimum card height at narrow widths. [Home layout](../src/pages/home/home.css) switches between three, two and one columns; [browser layout](../src/renderer/styles/global.css) keeps its fixed chrome height. Page widths and breakpoints are layout decisions, not new spacing primitives.

## 4. Semantic color rules

| Meaning | Token | Color | Usage |
| --- | --- | --- | --- |
| Action / information | `--primary`, `--info` | `#2563eb` | Primary action, active navigation, informational state |
| Success | `--success` | `#16a34a` | Completed operation, ready artifact, offer |
| Warning | `--warning` | `#d97706` | Needs review or attention |
| Error / destructive | `--danger` | `#dc2626` | Failed operation, invalid field, destructive action |

Use the matching background and border tokens. Prefer one clear primary action per task. Saved/Closed stay neutral; Applied/Interview use information styling. A pipeline stage is not automatically a warning or error. Include a label or icon so meaning does not depend on color alone. The current semantic mapping is illustrated by the [reference gallery](components/job-browser-component-library-8px.html); application workflows using it remain planned where their pages are placeholders.

## 5. Interaction and accessibility

These are requirements for UI additions and changes; they do not establish full accessibility certification:

- Sidebar items retain their complete accessible name and native tooltip when labels are hidden; use `aria-current="page"` for the active destination. Settings remains reachable in the fixed footer while the middle groups scroll.
- Give every control an accessible name. `IconButton` requires `aria-label`; inputs need an associated label or accessible name. `Icon` is decorative by default, so communicate meaning through the owning control or explicitly configure its accessible semantics.
- Settings composes 40px fields in 16px-radius panels with 24px padding (16px at narrow widths); page CSS owns layout only. Success feedback uses readable text on the success background/border. The gallery Settings example references these shared rules.
- Preserve native keyboard activation, disabled behavior and visible focus. A bare `TextInput` must live in a wrapper providing a visible focus treatment, as in [AddressBar](../src/pages/browser/AddressBar.tsx); its own outline is intentionally suppressed.
- Keep tab selection, keyboard focus and selected state aligned; [TabStrip](../src/pages/browser/TabStrip.tsx) owns its keyboard handling. Announce errors with appropriate text/roles, and keep long labels readable without hiding the full meaning.
- Distinguish loading, empty, success and error states. Do not make a reference example look like an implemented operation; page copy belongs to the [i18n catalog](../src/shared/i18n/locales/en.ts).
- Honor reduced-motion preferences and review wrapping, clipping and scroll behavior at narrow widths. Runtime motion rules live in [central styles](../src/shared/ui/components.css) and [browser styles](../src/renderer/styles/global.css).

Contrast, screen-reader behavior, enlarged text and complete keyboard coverage require manual review; current static checks do not prove them.

## 6. Maintenance and verification

1. Confirm the component exists in the public entry. Extend its implementation and `components.css` centrally if needed; keep page behavior and layout at the call site.
2. Edit `design-tokens.json` for shared values and `component-library.css`/gallery HTML for reference examples. Do not hand-edit generated exports. Changing a required scale also requires updating this specification and the checker's approved-value assertions in the same change.
3. Regenerate only when token or reference-style inputs change:

```sh
npm run design:tokens
```

4. Run the relevant checks. `quality` includes design validation and bilingual-document checks; it is sufficient for documentation-only changes. Runtime UI changes also need the appropriate application checks in [README](../README.md#validation-and-build).

```sh
npm run design:check
npm run quality
```

5. Review application and gallery presentation where changed: normal/hover/focus/disabled states, long text, semantic feedback and narrow layouts. Update the owning document and its translation, then inspect `git diff --check`.

| Verification | What it proves | Limits |
| --- | --- | --- |
| [Design checker](../scripts/design-system.cjs) | Generated-file consistency, approved token values, declared spacing/fixed geometry, token references, gallery links and ten categories; rejects `.ui-*` selectors outside Shared UI | Does not prove every computed layout, state or accessibility property |
| [Quality checker](../scripts/quality.cjs) | Native reusable JSX controls/icons and explicit JSX `style` attributes rejected outside central UI; App/Page/Renderer component imports use the public entry; documentation parity, paths and lengths | Different-class duplicates, prop-spread bypasses and dynamically constructed elements still require review |
| [Browser smoke](../scripts/browser-smoke.cjs) | Home at 320/640/1200px, minimum card height, overflow, central card geometry and rendered chrome meeting native bounds | Not a complete gallery, accessibility or visual-regression suite |
| [Inbox smoke](../scripts/inbox-smoke.cjs) | Full-content native bounds, no app chrome, resizing, redirects, history and load recovery | Uses local fixtures; does not certify provider websites |
| [Sidebar smoke](../scripts/sidebar-smoke.cjs) | All destinations, active state, keyboard activation, responsive width and native-view clearance | Does not certify all assistive technology |
| [Settings smoke](../scripts/settings-smoke.cjs) | Real forms, labels, 40px controls, 16px panels, 320/640/1200px layout, language, validation and key lifecycle | Does not certify screen-reader behavior or provider access |

Native bounds consume [generated geometry](../src/shared/ui/geometry.ts) through the [browser contract](../src/shared/browser.ts). Do not independently change CSS and Main toolbar heights. [Build configuration](../electron.vite.config.ts) selects the Renderer entry; scripts and commands are authoritative in [package.json](../package.json).

## 7. Related documents

- [Design brief](../DESIGN.md): visual direction and design entry point.
- [Current architecture](architecture.md): implemented behavior and limitations.
- [Code architecture](code-architecture.md): dependency boundaries and page ownership.
- [Product architecture](product-architecture.md): planned business workflows represented by examples.
