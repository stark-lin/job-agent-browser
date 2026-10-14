# Current Runtime Architecture

Purpose: record verified runtime behavior. Status: **Implemented** React application composition, nine accessible entries, per-tab mixed navigation, browser foundation, Settings, OpenAI-compatible SSE chat and business storage. Business workflows and compilation remain **Planned**; remaining feature-page UI is **Scaffolded**.

Language: English · [简体中文](architecture.zh-CN.md)

## 1. Runtime and process boundaries

[Build configuration](../electron.vite.config.ts) selects [Main](../src/platform/electron/main/index.ts), [Preload](../src/platform/electron/preload/index.ts), and the [Renderer HTML entry](../src/renderer/index.html). The [package entry](../package.json) remains `out/main/index.js`.

```text
React App → Page → Preload → IPC → Main
                                  ├── Mixed history + WebContentsView → Session
                                  ├── Domain services → SQLite + audit
                                  └── AI service → Provider SSE
```

The [Renderer bootstrap](../src/renderer/main.tsx) mounts the single [App](../src/app/App.tsx) in StrictMode. [Providers](../src/app/providers.tsx) inject controlled browser/data/AI bridges and context; the [navigation store](../src/app/navigation/navigationStore.ts) subscribes once per provider lifecycle and ignores older snapshots and disposed initialization reads. [Router](../src/app/router.tsx) selects React pages from Main's active destination without navigating the trusted document.

[BrowserPage](../src/pages/browser/BrowserPage.tsx) alone renders tabs, address input and browser controls. Home and business pages render no browser chrome or internal URL. [HomeGrid](../src/pages/home/HomeGrid.tsx) enables all nine cards. [Settings](../src/pages/settings/SettingsPage.tsx) implements local preferences and encrypted-key management. [Inbox](../src/pages/inbox/InboxPage.tsx) owns a full-content webmail surface, configuration guidance and load recovery. [Ask AI](../src/pages/ai/AskAIPage.tsx) implements streaming chat; five other feature entries remain scaffolded.

## 2. Routes and mixed history

The [destination contract](../src/shared/navigation.ts) allowlists `app://home`, `app://find`, `app://resume`, `app://interview`, `app://applications`, `app://inbox`, `app://profile`, `app://browser`, `app://ai` and `app://settings`. Internal URLs are navigation identifiers, not registered OS protocols or documents loaded by Chromium. Unknown internal targets are rejected before changing history. Public URLs are owned by [product architecture](product-architecture.md).

[BrowserManager](../src/platform/browser/browserManager.ts) owns tabs, active destination and versioned snapshots. Each tab starts on Home. Home adds an internal history entry; new tabs and closing the final tab create fresh Home destinations. Selecting Browser adds an empty browser workspace with an empty address field. Selecting another tab never adds history. Closing the active tab selects its right neighbor, or its left neighbor if last.

[MixedHistory](../src/platform/browser/mixedHistory.ts) combines internal entries with continuous web-history segments. Each [WebSegment](../src/platform/browser/webSegment.ts) retains its own native view and Chromium history. Back/Forward traverse native indices inside a segment, then cross internal/segment boundaries. Internal navigation hides existing views without navigating or destroying them, preserving the current page state when returning directly. Normal Chromium history traversal may reload older documents.

New navigation after Back trims both the app forward stack and the current segment's native forward entries. Unreachable segments are closed; tab/window closure releases all retained views. Website links, redirects and SPA navigation update native history; traversal and replacement do not append app entries. Duplicate URLs retain native entry identity. The private [Chromium history observer](../src/platform/browser/nativeHistory.ts) reads stable entry IDs through the internal debugging protocol to distinguish new visits from website-driven traversal; it injects no page scripts and exposes no debugging bridge. Loading/error events remain associated with their original segment and never activate a background tab or internal page.

[Web input parsing](../src/platform/browser/navigationManager.ts) preserves HTTP(S), recognizes domains/IPs/localhost and searches other terms on Google. Bare addresses default to HTTPS; localhost and loopback default to HTTP. Empty input, invalid explicit web addresses and other schemes are rejected. [Tests](../tests/navigation.test.ts) retain those rules; [mixed-history tests](../tests/mixed-history.test.ts) cover internal routing and segment traversal/branching.

## 3. Presentation and interaction

[WorkspaceSidebar](../src/app/WorkspaceSidebar.tsx) remains beside every page, with Home, nine features, translated groups and a single active item. Shared [feature metadata](../src/app/navigation/features.ts) supplies both the sidebar and Home icons/order. Clicking another feature uses the same navigation API and unsaved-settings guard; selecting the current feature does not add history. [HomePage](../src/pages/home/HomePage.tsx) renders the launcher without a Back button. Other business pages provide only a Go home button for page navigation, with no cross-page Back/Next/Forward controls. Scaffolded pages supply their own buttons and handlers through the [placeholder layout](../src/shared/ui/PlaceholderPage.tsx) action slot; the layout defines no navigation behavior. [Browser controls](../src/pages/browser/BrowserControls.tsx) retain Home, Back and Forward. Button ownership rules are defined in [code architecture](code-architecture.md#page-button-ownership).

**Implemented:** page controls/cards/icons reuse the [central UI components](../src/shared/ui/index.ts), styled by the [central runtime stylesheet](../src/shared/ui/components.css); page behavior remains local. [Shared tokens](../src/shared/ui/design-tokens.json) supply the 8px spacing, component sizes, typography and semantic colors used by [Home](../src/pages/home/home.css) and [application styles](../src/renderer/styles/global.css). The [design specification](design-system.md) owns those rules and the ten-category HTML reference gallery; gallery examples do not establish business functionality.

Only the active web segment can be shown. Browser segments start below its 48px tab strip and 48px toolbar (96px total, from [shared geometry](../src/shared/ui/geometry.ts)); Inbox segments start at `y = 0` and use the full content height; app tabs, address controls and a top bar remain absent. Both native surfaces start to the right of the sidebar, using [generated geometry](../src/shared/ui/geometry.ts): 208px at widths above 960px, 64px at or below it. [Generated responsive CSS](../src/shared/ui/sidebar-responsive.css) follows the same tokens, keeping all sidebar controls outside the native view. The sidebar Home entry replaces the mailbox Exit footer. Each [WebSegment](../src/platform/browser/webSegment.ts) retains its surface across redirects, native navigation and pop-ups; switching between Browser and Inbox creates a separate segment. Bounds follow window resizing. Target transitions hide all native views until the owning page acknowledges the tab/target through [native presentation](../src/app/navigation/useNativePresentation.ts). Stale visibility requests are ignored. Renderer reload hides views while providers resubscribe, then restores Main's destination/history; it does not reset the tab to Home.

[TabStrip](../src/pages/browser/TabStrip.tsx) supports creation, selection, closure, scrolling and arrow/Home/End selection. Internal destinations use page titles in tab labels; `app://` text is never rendered. [AddressBar](../src/pages/browser/AddressBar.tsx) follows state while idle and preserves drafts while focused; changing tabs resets the input.

[Shortcuts](../src/platform/browser/shortcuts.ts) work from the trusted renderer and native pages: `Cmd+T/W` on macOS or `Ctrl+T/W` elsewhere create/close tabs; `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle tabs. `Cmd+L`/`Ctrl+L` focuses/selects the address only on Browser. `Alt+Left/Right` traverses mixed history, including internal pages without browser chrome.

[Settings hook](../src/pages/settings/useSettings.ts) owns separate drafts and save feedback. Main confirms discarding unsaved Settings before navigation, history travel, tab switching/closure and window closure; stale draft registrations are ignored by tab/target identity. Configured `app://inbox` resolves to the saved HTTPS webmail address with an Inbox surface before entering history; unconfigured Inbox shows setup guidance. Mailbox failures hide the native view and show page-owned retry/settings actions. Storage semantics belong to [data architecture](data-architecture.md#6-settings-secrets-and-remaining-work).

**Implemented themes:** Settings offers Light, Dark and Follow system through the existing central `Select`. Theme and language are general-setting drafts: Save applies them after a successful write; failed saves and discarded drafts retain the active theme. Light remains the default; preference storage semantics belong to [data architecture](data-architecture.md#6-settings-secrets-and-remaining-work).

[Main](../src/platform/electron/main/index.ts) applies the saved theme before window creation. The [theme adapter](../src/platform/electron/main/theme.ts) sets Electron `nativeTheme.themeSource`; [BrowserManager](../src/platform/browser/browserManager.ts) publishes resolved `BrowserState.theme` on native updates without changing navigation targets/history. [App ThemeProvider](../src/app/theme.tsx) applies the root theme before React paints updates; generated CSS uses the native color preference before the first snapshot. The [window](../src/platform/electron/main/window.ts) and retained [WebSegments](../src/platform/browser/webSegment.ts) use generated theme backgrounds; one window-owned listener updates all retained views and is removed on window disposal. Recreated windows inherit the current native theme.

Follow system responds to native appearance updates; explicit Light/Dark overrides the system. Remote Browser/Inbox documents receive Chromium color preferences and retain website-controlled appearance; no forced recoloring is injected. Theme styling changes colors only, as defined in the [design system](design-system.md#4-semantic-color-rules). The [focused theme runner](../scripts/theme-runtime-smoke.cjs) exercises this independently, including macOS window recreation; commands remain in README. Startup background matching reduces flashes; complete frame-level verification and native appearance review on Windows/Linux remain unverified.

[App Context](../src/app/context/appContext.ts) exposes the active page's tab/title/destination and nullable Job, Profile and Artifact IDs. The [reference store](../src/app/context/contextStore.ts) starts empty; it does not copy entities, extract page content or automatically select business records.

**Implemented AI:** [Main-owned service](../src/platform/ai/service.ts) snapshots the selected provider, model and credential at request creation. The [compatible adapter](../src/platform/ai/compatible.ts) posts Chat Completions requests beneath the configured Base URL and consumes SSE; redirects are rejected. Remote endpoints require HTTPS; loopback HTTP supports local services. No automatic retry, cross-provider fallback, tools, structured-output capability probing or model discovery is implemented.

[AI IPC](../src/platform/electron/main/ai-ipc.ts) exposes only start/cancel and returns events to the initiating trusted frame. [Renderer coordination](../src/app/ai/streamClient.ts) subscribes before invocation, buffers early events and removes subscriptions on terminal events or page disposal. The service bounds requests and context/output sizes, applies a 120-second total timeout and cancels requests on renderer navigation/destruction or shutdown. Provider SSE remains in Main; incremental IPC drives the UI.

[Chat](../src/pages/ai/useChat.ts) inherits the saved default, allows provider/model overrides and displays completed, failed or stopped responses. New chat clears messages; leaving the page cancels the request and clears memory-only history. Existing messages retain their response model labels when switching models. [AI Settings](../src/pages/settings/AISettingsSection.tsx) manages provider instances, manual model IDs and an explicit short streaming connection test. Automatic Job/Profile/page context and business generation remain planned. Audit and credential persistence are owned by [data architecture](data-architecture.md).

## 4. Session, security and storage

Remote views share `persist:job-agent-browser`, retaining website storage across restarts. Permission requests are denied; there is no multi-profile selector.

- [Trusted window](../src/platform/electron/main/window.ts) and [remote views](../src/platform/browser/webSegment.ts) disable Node integration and enable context isolation and sandboxing; remote web security remains enabled.
- Browser, data and AI IPC require the owning trusted document and top frame, and validate inputs. [Preload](../src/platform/electron/preload/index.ts) exposes named operations, never raw `ipcRenderer`.
- Remote main-frame navigation/redirects permit HTTP(S) only. HTTP(S) pop-ups create an app tab; native pop-ups and other schemes are denied. Remote pages cannot enter internal routes or access browser/data bridges.
- [Trusted HTML](../src/renderer/index.html) retains its CSP. Trusted UI external links use the operating-system browser through window creation.

Main opens storage and registers data handlers before creating the window, closes storage on quit and reports startup failure without resetting data. [Backend composition](../src/platform/database/backend.ts) injects repositories/transactions and recovers interrupted generation attempts. The [data architecture](data-architecture.md) owns implemented SQLite, business validation, persistence and content-free audit.

## 5. Internationalization

**Implemented:** English and [Simplified Chinese resources](../src/shared/i18n/locales/zh-CN.ts) support saved language selection. [English resources](../src/shared/i18n/locales/en.ts) centralize application-owned page copy, internal titles, tooltips, accessible labels, errors and native startup dialogs. [Shared initialization](../src/shared/i18n/index.ts) creates a separate i18next instance in each process from bundled resources, synchronously with English as the default and fallback. No translation network requests or system-language detection occur.

[App translation provider](../src/app/i18n.tsx) supplies that Renderer instance to `useTranslation()` and updates document title/language. Non-React code uses the shared `t` function; [Main](../src/platform/electron/main/index.ts) can translate before React starts. [Build configuration](../electron.vite.config.ts) injects the HTML title from the same English resource used for the native window. Complete sentence templates interpolate labels/titles, and React renders the result as text. User data, website titles/content and diagnostic-only exceptions remain outside the catalog. Main loads the saved language before creating a window and publishes it in browser snapshots; Renderer follows that language through its provider. New browser title/error strings use the active language; previously captured error text is not retranslated.

**Planned:** further languages and system-language detection. [Translation tests](../tests/i18n.test.ts) cover startup readiness, fallback, instance isolation, React resource consumption, interpolation safety and invalid-key type checking.

## 6. Verification and limitations

[AI tests](../tests/ai.test.ts) and [AI smoke](../scripts/ai-smoke.cjs) verify local compatible SSE, startup-only audit, cancellation, provider configuration and real IPC. [Integration tests](../tests/audit.test.ts) verify storage/privacy guarantees; [navigation-store tests](../tests/navigation-store.test.ts) cover subscription ordering and StrictMode cleanup. [Electron smoke](../scripts/smoke.cjs) exercises built Main/Preload, IPC and sender rejection. [Browser smoke](../scripts/browser-smoke.cjs) covers tabs, bounds, shortcuts, isolation and failures; [navigation smoke](../scripts/navigation-smoke.cjs) covers feature entry UI, mixed traversal, branching/disposal, SPA/duplicate history, reload, stale visibility and loading races. [Theme smoke](../scripts/theme-smoke.cjs) verifies color-only geometry, saved/draft themes, native updates and unchanged navigation. [Settings smoke](../scripts/settings-smoke.cjs) verifies real forms, bilingual reload, responsive geometry, validation, leave confirmation, Inbox routing and the encrypted-key lifecycle; [restart smoke](../scripts/settings-restart-smoke.cjs) verifies restoration in a fresh production process. [Inbox smoke](../scripts/inbox-smoke.cjs) verifies zero-inset native bounds, absence of app top bars, redirects/history/reload/pop-ups, retained drafts, resizing, isolation and load recovery using local fixtures. [Sidebar smoke](../scripts/sidebar-smoke.cjs) verifies all destinations, active state, keyboard activation, responsive geometry and short-window reachability. [Window-close smoke](../scripts/window-close-smoke.cjs) verifies release of retained views after the owning window closes. Commands are indexed in README.

Tab histories and context references are memory-only. Retained web segments are released by branching or closing tabs/windows; automatic eviction and cross-restart restoration are not implemented. Business workflows, page extraction, AI business generation, compilation, full Shared Context capture, installers remain unimplemented.

## 7. Related documents

- [README](../README.md): setup, validation and documentation index.
- [Product architecture](product-architecture.md): product rules and planned delivery order.
- [Code architecture](code-architecture.md): source ownership and dependency boundaries.
- [V1 data architecture and API](data-architecture.md): persistence and business interfaces.
