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
| Generated exports | [Tokens CSS](../src/shared/ui/design-tokens.css), [native colors](../src/shared/ui/theme-colors.ts), [native geometry](../src/shared/ui/geometry.ts), [native indicator styles](../src/shared/ui/history-indicator-styles.ts), [native navigation tooltip styles](../src/shared/ui/navigation-tooltip-styles.ts), [standalone reference CSS](components/job-browser-component-library-8px.css) |

The [Renderer entry](../src/renderer/main.tsx) imports `components.css`, which imports generated tokens. Shared setup skins live in [setup.css](../src/shared/ui/setup.css). The gallery loads the standalone reference CSS and provides downloads for that CSS, Tokens CSS and Tokens JSON. Save its HTML and standalone CSS together for offline viewing; no build or external fonts are required. Tokens JSON is a flat map of CSS values, not a DTCG schema.

The gallery retains ten categories: Foundations, Buttons, Forms, Navigation, Badges & chips, Cards, Job components, Feedback, Overlays and Tables. It includes spacing rulers and size examples. Sample jobs, actions and secrets guidance are reference content, not proof of application functionality.

Application and gallery styles are separate sources sharing the same tokens. The generator does not turn gallery examples into React components or synchronize their appearance with runtime components automatically; update both sources when a common visual rule changes.

## 2. Mandatory central component reuse

All application UI components must use `src/shared/ui/index.ts` (or its directory import). Page and feature-specific UI compose these primitives; structural elements such as `main`, `section`, `div`, `span` and `form` are allowed. Using tokens alone does not satisfy the reuse rule. Pure business Domain modules must remain UI-free, as required by [code architecture](code-architecture.md).

| Implemented component | Supported use | Implementation |
| --- | --- | --- |
| `Button`, `ActionRow`, `IconButton` | Action, icon and browser-tab variants, neutral pressed selection and start/end action alignment; callers supply labels and handlers | [Button.tsx](../src/shared/ui/Button.tsx) |
| `CopyButton` | Async copy action with duplicate-submit prevention; success changes the same disabled button to the supplied copied label with polite live feedback; failures remain retryable | [CopyButton.tsx](../src/shared/ui/CopyButton.tsx) |
| `TextArea` | Multiline model IDs, chat input and personal introduction; 96px token minimum, resize/focus/disabled/error states | [TextArea.tsx](../src/shared/ui/TextArea.tsx) |
| `Checkbox` | Native keyboard/focus/disabled behavior, associated wrapping label, 40px minimum target and 16px check control; independent ignore controls | [Checkbox.tsx](../src/shared/ui/Checkbox.tsx) |
| `TextInput` | Text, URL, password and numeric fields, or bare input inside a styled wrapper | [TextInput.tsx](../src/shared/ui/TextInput.tsx) |
| `ListInput` | Comma-separated lists using `TextInput` presentation; retains trailing delimiters while typing and resets on external value changes | [ListInput.tsx](../src/shared/ui/ListInput.tsx) |
| `ExternalLink` | Business source HTTP(S) links; reject credentials/other schemes and open externally | [ExternalLink.tsx](../src/shared/ui/ExternalLink.tsx) |
| `Glyph` | Shared named SVG symbols used by workspace navigation | [Glyph.tsx](../src/shared/ui/Glyph.tsx) |
| `historyIndicatorDocument` | Scriptless native history arrow; fixed position, ready and unavailable states | [HistoryIndicator.ts](../src/shared/ui/HistoryIndicator.ts), [history-indicator.css](../src/shared/ui/history-indicator.css) |
| `Sidebar`, `NavigationGroup`, `NavigationItem` | Icon rail, accessible navigation groups and named buttons with anchored title tooltips and current-page state | [Sidebar.tsx](../src/shared/ui/Sidebar.tsx) |
| `Icon`, `IconBox` | SVG glyph and neutral/primary icon container | [Icon.tsx](../src/shared/ui/Icon.tsx) |
| `FeatureCard` | Feature entry with icon, label and description | [FeatureCard.tsx](../src/shared/ui/FeatureCard.tsx) |
| `LanguageBackground`, `SegmentedControl` | Shared language/background groups used by setup and Settings; labelled pressed buttons with native keyboard behavior. The segmented control follows the supplied reference: 40px outer height, 32px buttons, an inset and gap of half `--space-1`, 8px corners and quiet/selected semantic colors. | [LanguageBackground.tsx](../src/shared/ui/LanguageBackground.tsx) |
| `FormField`, `Select` | Associated labels, help/errors and native selection | [Form.tsx](../src/shared/ui/Form.tsx) |
| `SectionCard` | Titled collapsible content panels | [Form.tsx](../src/shared/ui/Form.tsx) |
| `StatusMessage` | Neutral, information, success and error feedback | [Form.tsx](../src/shared/ui/Form.tsx) |
| `Dialog` | Native modal focus containment, optional body content and page-owned actions/cancellation | [Dialog.tsx](../src/shared/ui/Dialog.tsx) |
| `DataTable`, `Badge`, `DetailsList` | Named scroll region with column headers, metadata rows and text-labelled neutral/success/error badges | [DataTable.tsx](../src/shared/ui/DataTable.tsx) |
| `PlaceholderPage` | Explicit coming-soon layout with page-provided actions | [PlaceholderPage.tsx](../src/shared/ui/PlaceholderPage.tsx) |
| `StageProgress` / `DocumentPreview` | Ordered business stages with current-step semantics and optional backward navigation; WizardCard/ChoiceCard/QuietPanel/Radio provide shared setup surfaces (including a dashed PDF panel) and selection controls ([Setup.tsx](../src/shared/ui/Setup.tsx)); an opaque-origin, scriptless iframe with 640px shared height and navigation blocked by Main | [StageProgress.tsx](../src/shared/ui/StageProgress.tsx), [DocumentPreview.tsx](../src/shared/ui/DocumentPreview.tsx) |

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

Designless V3 is implemented in the canonical tokens and shared skins. The supplied V3 HTML/CSS is a visual reference, not a replacement package: retain application DOM, business copy/data, workflows, page composition, breakpoints, column counts, spacing and type sizes. Its single-column showcases and demo interactions do not prescribe application layout or behavior. The existing gallery retains its ten categories and controls.

| Surface / meaning | Token | Light / dark | Usage |
| --- | --- | --- | --- |
| Application / rail | `--app`, `--rail` | `#E8EAED` / `#101113`; `#E1E4E8` / `#191B1E` | Silver Graphite / Neutral Black shell |
| Page / component | `--bg`, `--surface` | `#F6F7F9` / `#141618`; `#FFFFFF` / `#24272C` | Opaque neutral layers |
| Control / selected | `--quiet`, `--selected` | `#E8EAEE` / `#353A40`; `#E1E5EB` / `#24272B` | Neutral controls and selection |
| Action | `--primary`, `--primary-hover` | `#0066FF` in both | Primary actions, current stage and focus outline; active icon-rail items use `--rail-active` (`rgba(0,102,255,.2)`, 80% transparent) with `--on-rail-active` icons (`#174A8B` light / `#A8CCFF` dark) |
| Success | `--success` | `#186541` / `#7EDCAA` | Completed operation or ready artifact |
| Warning | `--warning` | `#815000` / `#FFD08A` | Needs review or attention |
| Error / destructive | `--danger` | `#A52E34` / `#FF9D98` | Failed operation, invalid field or destructive action |

Use semantic color sparingly on small text/icons with genuine labels. Status surfaces remain neutral; destructive buttons retain the restrained danger background. Saved/Closed remain neutral; Applied/Interview use information styling. A stage is not automatically a warning/error. `--info` and normal links use readable foreground text, including on dark surfaces where brand blue fails normal-text contrast. Links retain underlines. Use `--on-primary` (white in both themes) on primary-blue controls; translucent blue rail selection uses `--on-rail-active`. Normal text targets ≥4.5:1; required non-text state distinctions target ≥3:1. Static validation checks selected pairs, not every composited state.

`--line`/`--line-hover` are transparent to remove decorative framing without changing existing border-box geometry. Preserve functional separators with `--muted-line`, add-card outlines with `--field-edge`, invalid-field edges and keyboard focus outlines. Section titles have no separator. Shadows communicate **component boundary distinguishability only**: static `--shadow` on outer cards/composer; `--shadow-dialog` on overlays, tooltips and Banner; nested cards get no extra shadow. Hover, focus, selection, success and progress never add/change a shadow. Use one 2px outline flush to the control for field/address focus, with the reserved 1px border transparent; invalid fields use the danger outline while focused and their danger border when blurred. Do not stack a colored border and a separate focus ring. Keep visible keyboard focus on buttons/navigation and omit glow. Avoid blue-tinted app surfaces, glass blur, gradients, decorative section numbers, emoji garnish, colored left bars and oversized shadows; retain functional icons and semantic labels.

Themes change colors only; structure, dimensions, spacing, type, corners, border widths, shadow offsets/blur, transitions and behavior are shared. The generator rejects non-color dark overrides and changed shadow geometry. Gallery-only colors also use canonical tokens.

Generated CSS supports `data-theme="light"` / `data-theme="dark"`; without an explicit attribute it follows `prefers-color-scheme`. The offline gallery follows the system without adding controls or scripts; hex captions document the light palette and fills follow the active theme. Set the root attribute in developer tools to inspect either theme. Application selection/synchronization belongs to [current architecture](architecture.md#3-presentation-and-interaction).

## 5. Interaction and accessibility

These are requirements for UI additions and changes; they do not establish full accessibility certification:

- The sidebar has no brand header or visible text labels. Place Ask AI first, followed by Manage (My Profile, Tailor Resume, Smart Note), Job search (Add Job, Applications, Inbox), Tools (Browser) and fixed-footer Settings. Centered 24px horizontal rules using `--muted-line` and `--border-width` separate these sections; rules are decorative, while groups retain translated accessible names. Items use the full translated name for accessibility and for a tooltip to the right of the icon. Hover or keyboard focus opens the tooltip immediately. Pointer exit, focus loss and Escape dismiss it. A [native overlay](../src/platform/browser/navigationTooltip.ts) shows the same label above Browser and Inbox web content. Use `aria-current="page"` for the active destination. Settings remains reachable while the middle groups scroll.
- Give every control an accessible name. `IconButton` requires `aria-label`; inputs need an associated label or accessible name. `Icon` is decorative by default, so communicate meaning through the owning control or explicitly configure its accessible semantics.
- External Agent setup in Settings composes central SectionCard, DetailsList, Badge, Button, Dialog and read-only TextArea. MCP configuration, connection results and per-Skill installation states remain separate. Skill install/update actions show paths and completed/pending results; differing folders require a confirmation listing conflicts with Cancel initially focused and explicit replacement without backups. MCP reconnect republishes configuration and verifies a fresh connection; Skills reconnect reinstalls the bundled folders. MCP and per-Skill/all-Skills deletion use confirmation dialogs with paths, affected names and Cancel initially focused; outcomes distinguish completed and pending removal. Host reload guidance stays explicit. Other Agents can open the bundled Skills folder. MCP replacement retains its separate backup behavior. Paths wrap, busy actions are disabled and the static Settings gallery illustrates the controls.

- Use shared `ActionRow` to group related actions at the right edge of their section. Wrapped lines stay right-aligned. Put status text before the buttons when sharing the row.
- Every `SectionCard` has a title and a keyboard-operable header. The collapsed card keeps a single title row with a right-pointing chevron and 16px of padding above and below. The chevron points down when expanded, and descriptions and content reappear with existing spacing. Adjacent top-level cards have a 24px vertical gap. Adjacent nested cards have a 16px vertical gap. Nested cards reuse `SectionCard`, toggle independently and retain their contents and state when their parent closes. Validation reveals cards that contain invalid fields.
- Profile groups use plain headings. Entries and import review cards can contain fact cards, with at most two card levels. Add buttons for entries, facts, job locations and requirements use a dashed outline and match the width, height, corner radius and vertical gap of collapsed cards in their stack.
- Settings cards at every level start collapsed. Content cards on other pages start expanded. Expanded panels use a 16px radius and 24px padding (16px at narrow widths). Panels containing nested cards use 16px padding on all sides at every width. Settings fields are 40px high. Page CSS owns layout only. Success feedback uses semantic text on a neutral surface. The gallery Settings example uses the shared card styles.
- Import pages use central status components for reading and parsing and offer a full parse retry on failure. Tailor Resume shares Profile fields, entry cards and editor dialogs. The edit section uses a plain heading. Bullet cards nest one level inside entry cards. Manual resume dates and links use text inputs, with up to 200 characters for dates and empty statement text allowed. Entry dialogs preserve the entered text before Save and rebuild PDF.
- Profile composes central cards, fields, ignore checkboxes, badges and dialogs. Basic information and import review use `TextArea` for the optional personal introduction (2,000-character limit); help text states that Agents may only make minor edits. The Forms gallery includes an example. Saving submits valid non-ignored content; imported text fields may be empty, and format errors appear beside the fields and receive focus. Ignoring a parent excludes its facts. Unconfirmed Review stays editable; one confirmation saves the selected profile and snapshot and clears the temporary Review, without a visible draft status or extra freeze step. [Import review](../src/pages/profile/ImportReview.tsx) shows all entry metadata fields regardless of type and uses the same [Fact fields](../src/app/profile-editor/ProfileFields.tsx) as manual editing: category, content and tags, with no source attachment editor or detail row. Labels wrap at narrow widths; the Forms gallery illustrates ignored states.
- Data tables reuse central `DataTable`, `Badge`, `DetailsList` and `Dialog`. Cells have 8px vertical padding and show the first line with ellipsis. Application rows open details on click; the first cell supports keyboard activation and focus restoration. Tables scroll horizontally within the page; detail dialogs scroll within the viewport. The Tables gallery retains a generic reference.
- Tailor Resume uses central fields, actions, StageProgress and DocumentPreview. Show profile copy, bullet rewrite, validation, publication and output as separate steps. Agent Trace occupies its own central SectionCard immediately below generation progress, collapsed by default for each selected run. The card is available as soon as the Agent attaches. Expanding loads a live snapshot and streams text/tool events; polling keeps cycle/request diagnostics synchronized, and collapsing stops both. It reuses the Ask timeline detail presentation. Copy diagnostic JSON fetches the latest generation state, artifact output metadata and Agent trace, with button success feedback and retryable errors. The Feedback gallery shows the progress and trace controls. PDF typography belongs to the output template.
- Preserve native keyboard activation, disabled behavior and visible focus. A bare `TextInput` must live in a wrapper providing a visible focus treatment, as in [AddressBar](../src/pages/browser/AddressBar.tsx); its own outline is intentionally suppressed.
- Browser Back/Forward, Alt history shortcuts, right-button drags and horizontal touchpad swipes stay within webpage history; workspace navigation preserves browser state and forward entries. Gesture content and chrome stay fixed; the central `historyIndicatorDocument` primitive shows a 48px circular arrow inside a 64px transparent native overlay at the corresponding edge, with an 8px inset. Available arrows use the text/surface tokens, readiness uses primary/on-primary, unavailable directions use muted/panel-solid; short or cancelled strokes hide the arrow immediately with no translation or animation; successful history navigation and refresh use the solid neutral `--browser-transition-bg` (#303030 in both light and dark themes) cover until the target frame is ready, then reveal directly. Browser workspace/base canvas uses the separate `--browser-canvas-bg` (#e5e5e5 light / #303030 dark). Refresh follows Forward and is also present in native Browser/Inbox menus; ordinary right clicks retain native menus and website scrolling takes priority. Indicator and gesture geometry use generated values from existing size/spacing tokens. New tabs open an empty Browser workspace; browser titles label tabs. Keep tab selection, keyboard focus and selected state aligned; [TabStrip](../src/pages/browser/TabStrip.tsx) owns its keyboard handling. Announce errors with appropriate text/roles, and keep long labels readable without hiding the full meaning.
- Browser places a shared copy icon button immediately after the address field. Copy Webpage is disabled for blank, loading, or failed pages. Both the toolbar and native context menu show “Copied” in the toolbar on success and an alert on failure. [Browser controls](../src/pages/browser/BrowserControls.tsx)
- Distinguish loading, empty, success and error states. Do not make a reference example look like an implemented operation; page copy belongs to the [i18n catalog](../src/shared/i18n/locales/en.ts).
- Honor reduced-motion preferences and review wrapping, clipping and scroll behavior at narrow widths. Runtime motion rules live in [central styles](../src/shared/ui/components.css) and [browser styles](../src/renderer/styles/global.css).

Contrast, screen-reader behavior, enlarged text and complete keyboard coverage require manual review; current static checks do not prove them.

### Ask AI V2 conversation

[Conversation primitives](../src/shared/ui/Conversation.tsx) own ChatMessage, Collapsible, ActivityRow, SessionEntry, Drawer and ComposerSurface; [Markdown](../src/shared/ui/Markdown.tsx) renders a safe subset with escaped HTML, HTTP(S)-only links, code copying and locally scrollable code/tables. All are exported centrally. The Feedback gallery includes static conversation references.

The persistent application icon rail stays 64px. The chat session list uses `--chat-sidebar-width` (256px), becoming a modal drawer below 960px; the content column uses `--chat-content-width` (768px). Ask AI has no top bar or role/model message cards. User messages have a neutral bubble with 16px / 16px / 0 / 16px corners; assistant output uses direct typography. The composer has 8px corners. The bottom composer contains a compact model selector beside Send/Stop on one row, shrinking the selector on narrow screens. Empty chats center the introduction/composer. ComposerSurface keeps its neutral boundary and static boundary shadow on focus; its textarea has no focus outline or glow, while the model selector and action buttons retain their own focus indicators.

Returned reasoning text and summaries have distinct labels, source/state/elapsed details and full-text copying; encrypted blocks explicitly state that readable text is unavailable. Reasoning expands while streaming and collapses on completion unless the user changed its state. Models without reasoning show Working. Tool rows retain compact summaries and collapsed details containing call ID/name, state, elapsed time, redacted full arguments/results and fixed errors. Shared CodeBlock provides copying and locally scrollable JSON or wrapped reasoning; unknown write outcomes explicitly request state review. Completed writes remain visible after Stop. Delete requires an idle session and confirmation; attempted writes suppress automatic Retry.

Enter sends, Shift+Enter inserts a line break and IME composition never sends. Busy chats accept Send into the durable Pending queue while Stop remains available; switching chats restores drafts and scroll positions. Near-bottom output follows automatically; upward scrolling preserves position and offers a jump to latest. Loading earlier Items preserves the viewport. Focusable controls, drawer Escape/focus containment, reduced motion and concise live status apply; token deltas are not announced individually.

[Session actions](../src/pages/ai/SessionSidebar.tsx) use Rename → Copy Debug JSON → Delete. Copy composes central Dialog/Button/CopyButton/StatusMessage with a full sensitive-data warning, Cancel initially focused and Copy JSON; no checkbox or new presentation tokens. Opening, Cancel and Escape do not copy. Each confirmation pins its Session (including running Sessions), disables repeat submission, keeps the dialog open and changes the CopyButton to “Copied to clipboard” on success, or retains an error/retry dialog on failure. The successful button stays disabled until the dialog is dismissed; no success message appears under the chat list. The Overlays gallery includes the warning; full data stays in Main.

Existing StatusMessage primitives show Pending, context compaction and Human waiting; old discovery/activation records remain displayable. The [global Human Ask dialog](../src/app/components/HumanAskDialog.tsx) composes Dialog (central ActionRow), Radio, TextArea, FormField and Button: optional single choice, always free text, clear selection, explicit Cancel and Submit disabled until answered. It works across every workspace page; Main temporarily hides native Browser/Inbox views without resetting navigation. Memory uses ordinary tool rows. A Session stays busy only while its Run runs. Model context/output controls remain available; there is no Memory mode toggle or console.

[Tool details](../src/app/components/AgentTimelineItem.tsx) compose existing DetailsList and Collapsible for Chat Run ID/final state, Guard calls/dispatches/rejections, confirmed effects and localized stop reasons. Optional Warning/Recovery and Next action rows explain a strategy change without changing the successful tool state. Pre-execution rejection is labelled “Not executed”; completed and uncertain results retain their own states. The Feedback gallery includes these distinctions; tokens and geometry remain unchanged.

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
| [Design checker](../scripts/design-system.cjs) | Generated-file consistency, color-only overrides/unchanged shadow geometry, selected light/dark text contrast ≥4.5:1, approved token values, declared spacing/fixed geometry, token references, gallery links and ten categories; rejects `.ui-*` selectors outside Shared UI | Does not prove every computed layout, state or accessibility property |
| [Quality checker](../scripts/quality.cjs) | Native reusable JSX controls/icons and explicit JSX `style` attributes rejected outside central UI; App/Page/Renderer component imports use the public entry; documentation parity, paths and lengths | Different-class duplicates, prop-spread bypasses and dynamically constructed elements still require review |
| [Browser smoke](../scripts/browser-smoke.cjs) | Ask AI startup, sidebar switching and rendered browser chrome meeting native bounds | Not a complete gallery, accessibility or visual-regression suite |
| [Inbox smoke](../scripts/inbox-smoke.cjs) | Full-content native bounds, no app chrome, resizing, redirects, history and load recovery | Uses local fixtures; does not certify provider websites |
| [Sidebar smoke](../scripts/sidebar-smoke.cjs) | All destinations, active state, keyboard activation, fixed icon-rail width, tooltip placement and dismissal, and native-view clearance | Does not certify all assistive technology |
| [AI smoke](../scripts/ai-smoke.cjs) | Provider endpoint/timeout forms, model detection/selection with central controls, real SSE/IPC, cancellation and 320/640/1200px overflow checks | Local fixtures do not certify third-party provider behavior |
| [Ask AI smoke](../scripts/ask-ai-runtime-smoke.cjs) | Streaming activity, concurrent sessions, targeted Stop, draft/scroll restoration, bilingual themes at 320/640/1200px and forced-process recovery | Local fixtures; not live-provider or screen-reader certification |
| [Profile smoke](../scripts/profile-smoke.cjs) | Manual entries/facts, built PDF Worker/SSE, single confirmation/snapshot, ignore controls, reload/pagination, bilingual light/dark layout at 320/640/1200px and leave guards | Uses generated PDFs/local AI fixtures; does not certify third-party Providers, arbitrary PDF layouts or screen readers |
| [Settings smoke](../scripts/settings-smoke.cjs) | Collapsed defaults, keyboard activation, nested panels, draft retention, real forms, labels, 40px controls, 16px panels, 320/640/1200px layout, language, validation and key lifecycle | Does not certify screen-reader behavior or provider access |
| [Theme smoke](../scripts/theme-smoke.cjs) and [restart smoke](../scripts/settings-restart-smoke.cjs) | Draft/save/failure/discard, simulated native appearance updates, unchanged navigation/native bounds, Settings and Ask AI geometry at 320/640/1200px, all gallery element geometry and persisted dark startup | Theme-only runner uses persisted preferences; does not cover first-write dirty-state normalization, actual OS settings, every visual state or flash-free startup |

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
