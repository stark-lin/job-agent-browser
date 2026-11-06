# Component Library and Design System

Purpose: define enforceable component rules and the maintenance process. Status: **Implemented** light/dark color themes, tokens, CSS reference gallery, central React primitives and their use by Browser, Inbox, Ask AI, Profile, Settings, Add Job, Applications and placeholder pages. Remaining business feature pages are **Scaffolded**; remaining business workflows and React equivalents for the remaining gallery examples are **Planned**. Visual direction belongs to [DESIGN.md](../DESIGN.md).

Language: English · [简体中文](design-system.zh-CN.md)

## 1. Sources and reference assets

| Responsibility | Source of truth |
| --- | --- |
| Token values | [Light and shared tokens](../src/shared/ui/design-tokens.json), [dark color overrides](../src/shared/ui/design-tokens.dark.json) |
| Public UI primitives | [Central entry](../src/shared/ui/index.ts) |
| Shared application appearance | [components.css](../src/shared/ui/components.css) |
| Reference examples and their presentation | [Gallery HTML](components/job-browser-component-library-8px.html) and [component-library.css](../src/shared/ui/component-library.css) |
| Generated exports | [Tokens CSS](../src/shared/ui/design-tokens.css), [native colors](../src/shared/ui/theme-colors.ts), [native geometry](../src/shared/ui/geometry.ts), [native indicator styles](../src/shared/ui/history-indicator-styles.ts), [standalone reference CSS](components/job-browser-component-library-8px.css) |

The [Renderer entry](../src/renderer/main.tsx) imports `components.css`, which imports generated tokens. The gallery loads the standalone reference CSS and provides downloads for that CSS, Tokens CSS and Tokens JSON. Save its HTML and standalone CSS together for offline viewing; no build or external fonts are required. Tokens JSON is a flat map of CSS values, not a DTCG schema.

The gallery retains ten categories: Foundations, Buttons, Forms, Navigation, Badges & chips, Cards, Job components, Feedback, Overlays and Tables. It includes spacing rulers and size examples. Sample jobs, actions and secrets guidance are reference content, not proof of application functionality.

Application and gallery styles are separate sources sharing the same tokens. The generator does not turn gallery examples into React components or synchronize their appearance with runtime components automatically; update both sources when a common visual rule changes.

## 2. Mandatory central component reuse

All application UI components must use `src/shared/ui/index.ts` (or its directory import). Page and feature-specific UI compose these primitives; structural elements such as `main`, `section`, `div`, `span` and `form` are allowed. Using tokens alone does not satisfy the reuse rule. Pure business Domain modules must remain UI-free, as required by [code architecture](code-architecture.md).

| Implemented component | Supported use | Implementation |
| --- | --- | --- |
| `Button`, `IconButton` | Action, icon and browser-tab variants; callers supply labels and handlers | [Button.tsx](../src/shared/ui/Button.tsx) |
| `CopyButton` | Async copy action with duplicate-submit prevention; success changes the same disabled button to the supplied copied label with polite live feedback; failures remain retryable | [CopyButton.tsx](../src/shared/ui/CopyButton.tsx) |
| `TextArea` | Multiline model IDs, chat input and personal introduction; 96px token minimum, resize/focus/disabled/error states | [TextArea.tsx](../src/shared/ui/TextArea.tsx) |
| `Checkbox` | Native keyboard/focus/disabled behavior, associated wrapping label, 40px minimum target and 16px check control; independent ignore controls and per-model parallel import opt-in | [Checkbox.tsx](../src/shared/ui/Checkbox.tsx) |
| `TextInput` | Text, URL, password and numeric fields, or bare input inside a styled wrapper | [TextInput.tsx](../src/shared/ui/TextInput.tsx) |
| `ListInput` | Comma-separated lists using `TextInput` presentation; retains trailing delimiters while typing and resets on external value changes | [ListInput.tsx](../src/shared/ui/ListInput.tsx) |
| `ExternalLink` | Business source HTTP(S) links; reject credentials/other schemes and open externally | [ExternalLink.tsx](../src/shared/ui/ExternalLink.tsx) |
| `Glyph` | Shared named SVG symbols used by workspace navigation | [Glyph.tsx](../src/shared/ui/Glyph.tsx) |
| `historyIndicatorDocument` | Scriptless native history arrow; fixed position, ready and unavailable states | [HistoryIndicator.ts](../src/shared/ui/HistoryIndicator.ts), [history-indicator.css](../src/shared/ui/history-indicator.css) |
| `Sidebar`, `NavigationGroup`, `NavigationItem` | Icon rail, accessible navigation groups and named native buttons with hover tooltips and current-page state | [Sidebar.tsx](../src/shared/ui/Sidebar.tsx) |
| `Icon`, `IconBox` | SVG glyph and neutral/primary icon container | [Icon.tsx](../src/shared/ui/Icon.tsx) |
| `FeatureCard` | Feature entry with icon, label and description | [FeatureCard.tsx](../src/shared/ui/FeatureCard.tsx) |
| `FormField`, `Select` | Associated labels, help/errors and native selection | [Form.tsx](../src/shared/ui/Form.tsx) |
| `SectionCard`, `PageHeading` | Shared panel and page heading presentation | [Form.tsx](../src/shared/ui/Form.tsx) |
| `StatusMessage` | Neutral, information, success and error feedback | [Form.tsx](../src/shared/ui/Form.tsx) |
| `Dialog` | Native modal focus containment, optional body content and page-owned actions/cancellation | [Dialog.tsx](../src/shared/ui/Dialog.tsx) |
| `DataTable`, `Badge`, `DetailsList` | Named scroll region with column headers, metadata rows and text-labelled neutral/success/error badges | [DataTable.tsx](../src/shared/ui/DataTable.tsx) |
| `PlaceholderPage` | Explicit coming-soon layout with page-provided actions | [PlaceholderPage.tsx](../src/shared/ui/PlaceholderPage.tsx) |
| `StageProgress` / `DocumentPreview` | Ordered business stages with current-step semantics; an opaque-origin, scriptless iframe with 640px shared height and navigation blocked by Main | [StageProgress.tsx](../src/shared/ui/StageProgress.tsx), [DocumentPreview.tsx](../src/shared/ui/DocumentPreview.tsx) |

- Add missing primitives or variants to `src/shared/ui/` and export them centrally before page use. Gallery-only forms, badges, job cards, feedback, dialogs and tables still need central React implementations where not represented by the existing primitives.
- Keep reusable appearance, sizes, visual states and accessibility defaults in the central library. Page CSS may arrange components with shared tokens; it must not duplicate control styles, redefine `.ui-*` selectors or bypass the library with inline styles.
- Pages own placement, business data, enabled/loading state, navigation and event handlers. Shared UI accepts props and composition slots; it must not import App/Page/Domain/Platform behavior. A `className` is for composition, not a second component skin.

[Browser controls](../src/pages/browser/BrowserControls.tsx), [AddressBar](../src/pages/browser/AddressBar.tsx), [Add Job](../src/pages/find-jobs/AddJobPage.tsx) and [Settings](../src/pages/settings/SettingsPage.tsx) consume these primitives. Capture source selection and the [Application Agent panel](../src/pages/applications/ApplicationAgentPanel.tsx) compose existing Select/TextArea/Button/SectionCard/StatusMessage; event history uses DetailsList. No new control skin or token is introduced. Do not copy gallery markup into a page or import private implementations.

## 3. Layout, geometry and typography

| Item | Required scale or size | Tokens |
| --- | --- | --- |
| Spacing | 0 / 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px | `--space-*` |
| Controls | Small 32px / default 40px / large 48px | `--control-sm`, `--control-md`, `--control-lg` |
| Toolbar | 48px | `--toolbar-height` |
| Browser tab strip / total chrome | 48px / 96px | `--tab-strip-height`, `--browser-chrome-height` |
| Workspace sidebar | 64px icon rail at every viewport width; 48px navigation items with 24px icons | `--sidebar-width`, `--control-lg`, `--space-3` |
| List row | 64px minimum; grow for content when necessary | `--list-row-height` |
| Feature card | 144px minimum at every viewport size | `--feature-card-height` |
| Icon / container | 16px / 32px or 40px | `--icon-size`, `--icon-box`, `--icon-box-lg` |
| Corners | 8 / 16 / 24px | `--radius-*` |
| Font sizes | 12 / 14 / 16 / 20 / 32 / 40px | `--font-*` |
| Line heights | 16 / 24 / 32 / 40 / 48px | `--line-*` |
| Borders / focus outline | 1px / 2px | `--border-width`, `--focus-width` |

All nonzero padding, gap and margin must use spacing tokens. Zero and automatic margins are allowed. Percentages, flexible tracks and `min()` are for fluid dimensions, not arbitrary spacing. `--space-N` counts 8px steps; unlisted steps such as 56px are excluded. Do not use viewport-based padding or continuously scaled font sizes in place of the defined scales.

Font sizes and stroke widths are grid exceptions. Circular dots and loading indicators use `50%` rounding; rectangular controls, chips and badges use the corner scale. SVG paths and glyph strokes are not layout measurements. Fluid rendered widths need not be divisible by eight.

Use grid/flex alignment to center icons, fixed token line heights for text, and `box-sizing: border-box` for borders. Let labels/descriptions wrap and retain minimum card height at narrow widths. [Browser layout](../src/renderer/styles/global.css) keeps its fixed chrome height. Page widths and breakpoints are layout decisions, not new spacing primitives.

## 4. Semantic color rules

| Meaning | Token | Light / dark | Usage |
| --- | --- | --- | --- |
| Action / information | `--primary`, `--info` | `#2563eb` / `#60a5fa` | Primary action, active navigation, informational state |
| Success | `--success` | `#16a34a` / `#4ade80` | Completed operation, ready artifact, offer |
| Warning | `--warning` | `#d97706` / `#fbbf24` | Needs review or attention |
| Error / destructive | `--danger` | `#dc2626` / `#f87171` | Failed operation, invalid field, destructive action |

Use the matching background and border tokens. Prefer one clear primary action per task. Saved/Closed stay neutral; Applied/Interview use information styling. A pipeline stage is not automatically a warning or error. Include a label or icon so meaning does not depend on color alone. The current semantic mapping is illustrated by the [reference gallery](components/job-browser-component-library-8px.html); application workflows using it remain planned where their pages are placeholders.

Themes change colors only: background, foreground, border, icon, focus and shadow colors. Component structure, dimensions, spacing, type, corners, border widths, shadow offsets/blur, transitions and behavior are shared. The generator rejects non-color dark overrides and changed shadow geometry. `--on-primary` is the primary-button foreground; do not reuse `--surface` for it. Gallery-only colors also use canonical tokens.

Generated CSS supports `data-theme="light"` / `data-theme="dark"`; without an explicit attribute it follows `prefers-color-scheme`. The offline gallery follows the system without adding controls or scripts; its hex captions document the light palette and its swatch fills follow the active theme. To review an explicit palette, set the root attribute in browser developer tools. Application selection/synchronization belongs to [current architecture](architecture.md#3-presentation-and-interaction).

## 5. Interaction and accessibility

These are requirements for UI additions and changes; they do not establish full accessibility certification:

- The sidebar has no brand header or visible text labels. Place Ask AI first, followed by Job search, Manage, Tools and fixed-footer Settings. Centered 24px horizontal rules using `--line` and `--border-width` separate these sections; rules are decorative, while groups retain translated accessible names. Items retain their complete translated accessible name and native hover tooltip; use `aria-current="page"` for the active destination. Settings remains reachable while the middle groups scroll.
- Give every control an accessible name. `IconButton` requires `aria-label`; inputs need an associated label or accessible name. `Icon` is decorative by default, so communicate meaning through the owning control or explicitly configure its accessible semantics.
- External Agent setup in Settings composes central SectionCard, DetailsList, Badge, Button, Dialog and read-only TextArea. MCP configuration, connection results and per-Skill installation states remain separate. Skill install/update actions show paths and completed/pending results; differing folders require a confirmation listing conflicts with Cancel initially focused and explicit replacement without backups. MCP reconnect republishes configuration and verifies a fresh connection; Skills reconnect reinstalls the bundled folders. MCP and per-Skill/all-Skills deletion use confirmation dialogs with paths, affected names and Cancel initially focused; outcomes distinguish completed and pending removal. Host reload guidance stays explicit. Other Agents can open the bundled Skills folder. MCP replacement retains its separate backup behavior. Paths wrap, busy actions are disabled and the static Settings gallery illustrates the controls.

- Settings composes 40px fields in 16px-radius panels with 24px padding (16px at narrow widths); page CSS owns layout only. Success feedback uses readable text on the success background/border. The gallery Settings example references these shared rules.
- Import mode controls compose central `FormField`/`Select`; model opt-in uses `Checkbox`. Independent part states/timings use `DetailsList`; only the completion summary uses live status text so timer ticks are not repeatedly announced, with explicit failed-part retry actions. Mode controls are disabled during work; unavailable parallel options explain the Settings prerequisite. The Forms gallery includes these controls.
- Profile composes central cards, fields, ignore checkboxes, badges and dialogs. Basic information and import review use `TextArea` for the optional personal introduction (2,000-character limit); help text states that Agents may only make minor edits. The Forms gallery includes an example. Saving submits valid non-ignored content; imported text fields may be empty, and format errors appear beside the fields and receive focus. Ignoring a parent excludes its facts. Saved parents remain visible for partial imports. [Import review](../src/pages/profile/ImportReview.tsx) shows all entry metadata fields regardless of type and uses the same [Fact fields](../src/pages/profile/ProfileFields.tsx) as manual editing: category, content and tags, with no source attachment editor or detail row. Labels wrap at narrow widths; the Forms gallery illustrates ignored states.
- The Settings Audit Viewer composes central `DataTable`, `Badge`, `DetailsList` and `Dialog` content. The table has 64px minimum rows, wrapping IDs, visible status text and a keyboard-focusable horizontal scroll region; it never expands the page width. Metadata dialogs scroll within the viewport. The Tables gallery includes the audit reference.
- Tailor Resume composes central selection fields, actions, stage progress, source details and document preview. Page CSS owns layout only; output retry, cancellation and system save show explicit statuses. The Feedback gallery includes both primitives. PDF typography is owned by the fixed output template rather than application controls.
- Preserve native keyboard activation, disabled behavior and visible focus. A bare `TextInput` must live in a wrapper providing a visible focus treatment, as in [AddressBar](../src/pages/browser/AddressBar.tsx); its own outline is intentionally suppressed.
- Browser Back/Forward, Alt history shortcuts, right-button drags and horizontal touchpad swipes stay within webpage history; workspace navigation preserves browser state and forward entries. Gesture content and chrome stay fixed; the central `historyIndicatorDocument` primitive shows a 48px circular arrow inside a 64px transparent native overlay at the corresponding edge, with an 8px inset. Available arrows use the text/surface tokens, readiness uses primary/on-primary, unavailable directions use muted/panel-solid; short or cancelled strokes hide the arrow immediately with no translation or animation; successful history navigation and refresh use the solid neutral `--browser-transition-bg` (#303030 in both light and dark themes) cover until the target frame is ready, then reveal directly. Browser workspace/base canvas uses the separate `--browser-canvas-bg` (#e5e5e5 light / #303030 dark). Refresh follows Forward and is also present in native Browser/Inbox menus; ordinary right clicks retain native menus and website scrolling takes priority. Indicator and gesture geometry use generated values from existing size/spacing tokens. New tabs open an empty Browser workspace; browser titles label tabs. Keep tab selection, keyboard focus and selected state aligned; [TabStrip](../src/pages/browser/TabStrip.tsx) owns its keyboard handling. Announce errors with appropriate text/roles, and keep long labels readable without hiding the full meaning.
- Browser places a shared copy icon button immediately after the address field. Copy Webpage is disabled for blank, loading, or failed pages. Both the toolbar and native context menu show “Copied” in the toolbar on success and an alert on failure. [Browser controls](../src/pages/browser/BrowserControls.tsx)
- Distinguish loading, empty, success and error states. Do not make a reference example look like an implemented operation; page copy belongs to the [i18n catalog](../src/shared/i18n/locales/en.ts).
- Honor reduced-motion preferences and review wrapping, clipping and scroll behavior at narrow widths. Runtime motion rules live in [central styles](../src/shared/ui/components.css) and [browser styles](../src/renderer/styles/global.css).

Contrast, screen-reader behavior, enlarged text and complete keyboard coverage require manual review; current static checks do not prove them.

### Ask AI V2 conversation

[Conversation primitives](../src/shared/ui/Conversation.tsx) own ChatMessage, Collapsible, ActivityRow, SessionEntry, Drawer and ComposerSurface; [Markdown](../src/shared/ui/Markdown.tsx) renders a safe subset with escaped HTML, HTTP(S)-only links, code copying and locally scrollable code/tables. All are exported centrally. The Feedback gallery includes static conversation references.

The persistent application icon rail stays 64px. The chat session list uses `--chat-sidebar-width` (256px), becoming a modal drawer below 960px; the content column uses `--chat-content-width` (768px). Ask AI has no top bar or role/model message cards. User messages have a subtle bubble; assistant output uses direct typography. The bottom composer contains a compact model selector beside Send/Stop on one row, shrinking the selector on narrow screens. Empty chats center the introduction/composer. ComposerSurface keeps its neutral border and shadow on focus; its textarea has no focus outline or glow, while the model selector and action buttons retain their own focus indicators.

Returned reasoning text and summaries have distinct labels, source/state/elapsed details and full-text copying; encrypted blocks explicitly state that readable text is unavailable. Reasoning expands while streaming and collapses on completion unless the user changed its state. Models without reasoning show Working. Tool rows retain compact summaries and collapsed details containing call ID/name, state, elapsed time, redacted full arguments/results and fixed errors. Shared CodeBlock provides copying and locally scrollable JSON or wrapped reasoning; unknown write outcomes explicitly request state review. Completed writes remain visible after Stop. Delete requires an idle session and confirmation; attempted writes suppress automatic Retry.

Enter sends, Shift+Enter inserts a line break and IME composition never sends. Busy chats accept Send into the durable Pending queue while Stop remains available; switching chats restores drafts and scroll positions. Near-bottom output follows automatically; upward scrolling preserves position and offers a jump to latest. Loading earlier Items preserves the viewport. Focusable controls, drawer Escape/focus containment, reduced motion and concise live status apply; token deltas are not announced individually.

[Session actions](../src/pages/ai/SessionSidebar.tsx) use Rename → Copy Debug JSON → Delete. Copy composes central Dialog/Button/CopyButton/StatusMessage with a full sensitive-data warning, Cancel initially focused and Copy JSON; no checkbox or new presentation tokens. Opening, Cancel and Escape do not copy. Each confirmation pins its Session (including running Sessions), disables repeat submission, keeps the dialog open and changes the CopyButton to “Copied to clipboard” on success, or retains an error/retry dialog on failure. The successful button stays disabled until the dialog is dismissed; no success message appears under the chat list. The Overlays gallery includes the warning; full data stays in Main.

Existing StatusMessage primitives show Pending, synchronous context compaction and discovery/activation. Memory reads/writes use ordinary tool timeline rows, with no background Memory status or retry action. A Session stays busy only while a Run is running. Settings per-model parallel opt-ins apply to imports; effective context/output controls remain available to Ask. There is no Ask Memory mode toggle or Memory console.

[Tool details](../src/pages/ai/TimelineItem.tsx) compose existing DetailsList and Collapsible for Chat Run ID/final state, Guard calls/dispatches/rejections, confirmed effects and localized stop reasons. Optional Warning/Recovery and Next action rows explain a strategy change without changing the successful tool state. Pre-execution rejection is labelled “Not executed”; completed and uncertain results retain their own states. The Feedback gallery includes these distinctions; tokens and geometry remain unchanged.

### Browser selection input

Browser business actions use Electron native menus; no app-styled context menu or new token is introduced. Ask and Add Job compose existing StatusMessage/Button for transfer failures and retry. Add Job shows the source title/URL with StatusMessage beside its ordinary Text input; content remains editable and Parse/Save stay explicit. Ask preserves existing drafts and appends source/quoted text to its new-chat composer. The Forms gallery includes the source/input/retry reference. Source text wraps within the page at narrow widths; native menu labels follow application language. Transfer creates no extra confirmation or permission flow.

### Global Banner

The [native Banner primitive](../src/shared/ui/Banner.ts) uses the shared 368px width, 80px height and 16px window inset. Title and detail use one line each with end truncation. The action and dismiss control are separate targets. Showing the Banner preserves field focus. Each accepted update starts a five-second dismissal timer. A dismissed event can reappear only as a newer event.

## 6. Maintenance and verification

1. Confirm the component exists in the public entry. Extend its implementation and `components.css` centrally if needed; keep page behavior and layout at the call site.
2. Edit `design-tokens.json` for light/shared values and `design-tokens.dark.json` for color-only overrides and `component-library.css`/gallery HTML for reference examples. Do not hand-edit generated exports. Changing a required scale also requires updating this specification and the checker's approved-value assertions in the same change.
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
| [Design checker](../scripts/design-system.cjs) | Generated-file consistency, color-only overrides/unchanged shadow geometry, selected dark text contrast ≥4.5:1, approved token values, declared spacing/fixed geometry, token references, gallery links and ten categories; rejects `.ui-*` selectors outside Shared UI | Does not prove every computed layout, state or accessibility property |
| [Quality checker](../scripts/quality.cjs) | Native reusable JSX controls/icons and explicit JSX `style` attributes rejected outside central UI; App/Page/Renderer component imports use the public entry; documentation parity, paths and lengths | Different-class duplicates, prop-spread bypasses and dynamically constructed elements still require review |
| [Browser smoke](../scripts/browser-smoke.cjs) | Ask AI startup, sidebar switching and rendered browser chrome meeting native bounds | Not a complete gallery, accessibility or visual-regression suite |
| [Inbox smoke](../scripts/inbox-smoke.cjs) | Full-content native bounds, no app chrome, resizing, redirects, history and load recovery | Uses local fixtures; does not certify provider websites |
| [Sidebar smoke](../scripts/sidebar-smoke.cjs) | All destinations, active state, keyboard activation, fixed icon-rail width, hover tooltip labels and native-view clearance | Does not certify all assistive technology |
| [AI smoke](../scripts/ai-smoke.cjs) | Provider endpoint/timeout forms, model detection/selection with central controls, real SSE/IPC, cancellation and 320/640/1200px overflow checks | Local fixtures do not certify third-party provider behavior |
| [Ask AI smoke](../scripts/ask-ai-runtime-smoke.cjs) | Streaming activity, concurrent sessions, targeted Stop, draft/scroll restoration, bilingual themes at 320/640/1200px and forced-process recovery | Local fixtures; not live-provider or screen-reader certification |
| [Audit Viewer smoke](../scripts/audit-viewer-smoke.cjs) | Filters, pagination, metadata dialogs, keyboard dismissal, no page overflow at 320/640/1200px and read-only/error/loading states | Does not certify screen readers or a snapshot across pages during concurrent writes |
| [Profile smoke](../scripts/profile-smoke.cjs) | Manual entries/facts, built PDF Worker/SSE, explicit saves/ignore controls, partial saves, reload/pagination, bilingual light/dark layout at 320/640/1200px and leave guards | Uses generated PDFs/local AI fixtures; does not certify third-party Providers, arbitrary PDF layouts or screen readers |
| [Settings smoke](../scripts/settings-smoke.cjs) | Real forms, labels, 40px controls, 16px panels, 320/640/1200px layout, language, validation and key lifecycle | Does not certify screen-reader behavior or provider access |
| [Theme smoke](../scripts/theme-smoke.cjs) and [restart smoke](../scripts/settings-restart-smoke.cjs) | Draft/save/failure/discard, simulated native appearance updates, unchanged navigation/native bounds, Settings and Ask AI geometry at 320/640/1200px, all gallery element geometry and persisted dark startup | Does not automate actual OS settings, certify every visual state or prove every startup frame is flash-free |

Native bounds consume [generated geometry](../src/shared/ui/geometry.ts) through the [browser contract](../src/shared/browser.ts). Do not independently change CSS and Main toolbar heights. [Build configuration](../electron.vite.config.ts) selects the Renderer entry; scripts and commands are authoritative in [package.json](../package.json).

## 7. Related documents

- [Design brief](../DESIGN.md): visual direction and design entry point.
- [Current architecture](architecture.md): implemented behavior and limitations.
- [Code architecture](code-architecture.md): dependency boundaries and page ownership.
- [Product architecture](product-architecture.md): planned business workflows represented by examples.

## Smart Note knowledge

Central [MarkdownEditor](../src/shared/ui/MarkdownEditor.tsx), [ExplorerRow/ResizableExplorer](../src/shared/ui/KnowledgeControls.tsx) and [Markdown](../src/shared/ui/Markdown.tsx) provide CodeMirror controls, accessible tree rows, resizing and safe AST rendering. HTML stays text; remote images do not load. Existing tokens and themes are reused without new geometry tokens.

Smart Note uses the shared `notebook` [Glyph](../src/shared/ui/Glyph.tsx), combining a notebook with a sparkle in workspace navigation. The Explorer divider uses `--border-width` (1px) and `--line`, with an invisible `--space-1` (8px) drag target; keyboard resizing and focus treatment remain available.

Knowledge Settings composes central Checkbox, DetailsList, Progress, Button, Dialog and StatusMessage for optional local semantic retrieval. Installation states, model dimensions/storage, download/repair/verify, progress/cancel and removal remain independent of the saved semantic preference. Removal confirms that notes/backups/indexes remain and automatic Seed import is disabled, with Cancel initially focused. Generative AI configuration remains separate. Tokens/geometry are unchanged; the Settings gallery includes model actions and the shared progress reference.

Memory v1 reuses this page and editor: a centrally rendered `brain` icon marks the pinned special root, collapsed initially. [ExplorerRow](../src/shared/ui/KnowledgeControls.tsx) owns selection/focus/disclosure and keyboard activation; page CSS owns layout only. Root rename/delete is disabled; inner folders use ordinary actions within their space. Selecting flushes first and preserves the old selection/draft on failure; identical README names have independent editor/save state. Search/history follow the selected space; restore names its target, while sync names the whole repository. The first/changed-remote confirmation explains uploading Memory and Git history, focuses Cancel and preserves local use when cancelled. The gallery shows the collapsed root and disclosure; existing tokens, geometry and themes are unchanged. [Memory UI smoke](../scripts/memory-ui-smoke.cjs) checks delayed save/search, failed flush, root protection and cancelled sync; full assistive-technology coverage remains unverified.
