# Current Runtime Architecture

Purpose: record verified runtime behavior. Status: **Implemented** React application composition, nine accessible entries, per-tab mixed navigation, browser foundation and business storage. Business workflows, AI execution and compilation remain **Planned**; feature-page UI is **Scaffolded**.

Language: English · [简体中文](architecture.zh-CN.md)

## 1. Runtime and process boundaries

[Build configuration](../electron.vite.config.ts) selects [Main](../src/platform/electron/main/index.ts), [Preload](../src/platform/electron/preload/index.ts), and the [Renderer HTML entry](../src/renderer/index.html). The [package entry](../package.json) remains `out/main/index.js`.

```text
React App → Page → window.browser / window.data → Preload → IPC → Main
                                                               ├── Mixed history + WebContentsView → Session
                                                               └── Domain services → SQLite + audit
```

The [Renderer bootstrap](../src/renderer/main.tsx) mounts the single [App](../src/app/App.tsx) in StrictMode. [Providers](../src/app/providers.tsx) inject controlled browser/data bridges and context; the [navigation store](../src/app/navigation/navigationStore.ts) subscribes once per provider lifecycle and ignores older snapshots and disposed initialization reads. [Router](../src/app/router.tsx) selects React pages from Main's active destination without navigating the trusted document.

[BrowserPage](../src/pages/browser/BrowserPage.tsx) alone renders tabs, address input and browser controls. Home and business pages render no browser chrome or internal URL. [HomeGrid](../src/pages/home/HomeGrid.tsx) enables all nine cards. Eight business pages provide explicit coming-soon content and no business workflow; Inbox links to the Settings placeholder.

## 2. Routes and mixed history

The [destination contract](../src/shared/navigation.ts) allowlists `app://home`, `app://find`, `app://resume`, `app://interview`, `app://applications`, `app://inbox`, `app://profile`, `app://browser`, `app://ai` and `app://settings`. Internal URLs are navigation identifiers, not registered OS protocols or documents loaded by Chromium. Unknown internal targets are rejected before changing history. Public URLs are owned by [product architecture](product-architecture.md).

[BrowserManager](../src/platform/browser/browserManager.ts) owns tabs, active destination and versioned snapshots. Each tab starts on Home. Home adds an internal history entry; new tabs and closing the final tab create fresh Home destinations. Selecting Browser adds an empty browser workspace with an empty address field. Selecting another tab never adds history. Closing the active tab selects its right neighbor, or its left neighbor if last.

[MixedHistory](../src/platform/browser/mixedHistory.ts) combines internal entries with continuous web-history segments. Each [WebSegment](../src/platform/browser/webSegment.ts) retains its own native view and Chromium history. Back/Forward traverse native indices inside a segment, then cross internal/segment boundaries. Internal navigation hides existing views without navigating or destroying them, preserving the current page state when returning directly. Normal Chromium history traversal may reload older documents.

New navigation after Back trims both the app forward stack and the current segment's native forward entries. Unreachable segments are closed; tab/window closure releases all retained views. Website links, redirects and SPA navigation update native history; traversal and replacement do not append app entries. Duplicate URLs retain native entry identity. The private [Chromium history observer](../src/platform/browser/nativeHistory.ts) reads stable entry IDs through the internal debugging protocol to distinguish new visits from website-driven traversal; it injects no page scripts and exposes no debugging bridge. Loading/error events remain associated with their original segment and never activate a background tab or internal page.

[Web input parsing](../src/platform/browser/navigationManager.ts) preserves HTTP(S), recognizes domains/IPs/localhost and searches other terms on Google. Bare addresses default to HTTPS; localhost and loopback default to HTTP. Empty input, invalid explicit web addresses and other schemes are rejected. [Tests](../tests/navigation.test.ts) retain those rules; [mixed-history tests](../tests/mixed-history.test.ts) cover internal routing and segment traversal/branching.

## 3. Presentation and interaction

[HomePage](../src/pages/home/HomePage.tsx) renders the launcher without a Back button. Other business pages provide only a Go home button for page navigation, with no cross-page Back/Next/Forward controls. Each page supplies its own buttons and handlers through the [placeholder layout](../src/shared/ui/PlaceholderPage.tsx) action slot; the layout defines no navigation behavior. [Browser controls](../src/pages/browser/BrowserControls.tsx) retain Home, Back and Forward. Button ownership rules are defined in [code architecture](code-architecture.md#page-button-ownership).

Only the active web segment can be shown, below Browser's 44-pixel tab strip and 64-pixel toolbar. Bounds follow window resizing. Target transitions hide all native views until BrowserPage acknowledges the active tab/target after committing. Stale visibility requests are ignored. Renderer reload hides views while providers resubscribe, then restores Main's destination/history; it does not reset the tab to Home.

[TabStrip](../src/pages/browser/TabStrip.tsx) supports creation, selection, closure, scrolling and arrow/Home/End selection. Internal destinations use page titles in tab labels; `app://` text is never rendered. [AddressBar](../src/pages/browser/AddressBar.tsx) follows state while idle and preserves drafts while focused; changing tabs resets the input.

[Shortcuts](../src/platform/browser/shortcuts.ts) work from the trusted renderer and native pages: `Cmd+T/W` on macOS or `Ctrl+T/W` elsewhere create/close tabs; `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle tabs. `Cmd+L`/`Ctrl+L` focuses/selects the address only on Browser. `Alt+Left/Right` traverses mixed history, including internal pages without browser chrome.

[App Context](../src/app/context/appContext.ts) exposes the active page's tab/title/destination and nullable Job, Profile and Artifact IDs. The [reference store](../src/app/context/contextStore.ts) starts empty; it does not copy entities, extract page content or automatically select business records.

## 4. Session, security and storage

Remote views share `persist:job-agent-browser`, retaining website storage across restarts. Permission requests are denied; there is no multi-profile selector.

- [Trusted window](../src/platform/electron/main/window.ts) and [remote views](../src/platform/browser/webSegment.ts) disable Node integration and enable context isolation and sandboxing; remote web security remains enabled.
- Browser and data IPC require the owning trusted document and top frame, and validate inputs. [Preload](../src/platform/electron/preload/index.ts) exposes named operations, never raw `ipcRenderer`.
- Remote main-frame navigation/redirects permit HTTP(S) only. HTTP(S) pop-ups create an app tab; native pop-ups and other schemes are denied. Remote pages cannot enter internal routes or access browser/data bridges.
- [Trusted HTML](../src/renderer/index.html) retains its CSP. Trusted UI external links use the operating-system browser through window creation.

Main opens storage and registers data handlers before creating the window, closes storage on quit and reports startup failure without resetting data. [Backend composition](../src/platform/database/backend.ts) injects repositories/transactions and recovers interrupted generation attempts. The [data architecture](data-architecture.md) owns implemented SQLite, business validation, persistence and content-free audit.

## 5. Internationalization preparation

**Implemented:** [English resources](../src/shared/i18n/locales/en.ts) centralize application-owned page copy, internal titles, tooltips, accessible labels, errors and native startup dialogs. [Shared initialization](../src/shared/i18n/index.ts) creates a separate i18next instance in each process from bundled resources, synchronously with English as the default and fallback. No translation network requests or system-language detection occur.

[App translation provider](../src/app/i18n.tsx) supplies that Renderer instance to `useTranslation()` and updates document title/language. Non-React code uses the shared `t` function; [Main](../src/platform/electron/main/index.ts) can translate before React starts. [Build configuration](../electron.vite.config.ts) injects the HTML title from the same English resource used for the native window. Complete sentence templates interpolate labels/titles, and React renders the result as text. User data, website titles/content and diagnostic-only exceptions remain outside the catalog. Browser IPC still carries English title/error strings.

**Planned:** additional translations, a language selector, saved language preferences and synchronization between processes. [Translation tests](../tests/i18n.test.ts) cover startup readiness, fallback, instance isolation, React resource consumption, interpolation safety and invalid-key type checking.

## 6. Verification and limitations

[Integration tests](../tests/audit.test.ts) verify storage/privacy guarantees; [navigation-store tests](../tests/navigation-store.test.ts) cover subscription ordering and StrictMode cleanup. [Electron smoke](../scripts/smoke.cjs) exercises built Main/Preload, IPC and sender rejection. [Browser smoke](../scripts/browser-smoke.cjs) covers tabs, bounds, shortcuts, isolation and failures; [navigation smoke](../scripts/navigation-smoke.cjs) covers feature entry UI, mixed traversal, branching/disposal, SPA/duplicate history, reload, stale visibility and loading races. [Window-close smoke](../scripts/window-close-smoke.cjs) verifies release of retained views after the owning window closes. Commands are indexed in README.

Tab histories and context references are memory-only. Retained web segments are released by branching or closing tabs/windows; automatic eviction and cross-restart restoration are not implemented. Business workflows, page extraction, AI generation execution, compilation, full Shared Context capture, mailbox configuration, settings/secrets persistence and installers remain unimplemented.

## 7. Related documents

- [README](../README.md): setup, validation and documentation index.
- [Product architecture](product-architecture.md): product rules and planned delivery order.
- [Code architecture](code-architecture.md): source ownership and dependency boundaries.
- [V1 data architecture and API](data-architecture.md): persistence and business interfaces.
