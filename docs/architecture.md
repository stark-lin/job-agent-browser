# Current Runtime Architecture

Purpose: record verified runtime behavior. Status: **Implemented** browser foundation, Home and business storage backend; business pages, AI execution and compilation remain **Planned**.

Language: English · [简体中文](architecture.zh-CN.md)

## 1. Runtime and process boundaries

[Build configuration](../electron.vite.config.ts) selects [Main](../src/main/index.ts), [Preload](../src/preload/index.ts), and the [Renderer HTML entry](../src/renderer/index.html). The [package entry](../package.json) points to `out/main/index.js`.

```text
React Renderer → window.browser / window.data → Preload → IPC → Main
                                                               ├── BrowserWindow / WebContentsView → Session
                                                               └── Domain services → SQLite + audit
```

[Main](../src/main/index.ts) owns window lifecycle and IPC; [window creation](../src/main/window.ts) creates the trusted UI and browser manager. [Preload](../src/preload/index.ts) exposes named operations from the [BrowserAPI](../src/shared/browser.ts), including navigation, visibility, state retrieval, and state subscriptions.

[BrowserManager](../src/main/browser/BrowserManager.ts) owns one persistent page view per window, below the 64-pixel toolbar, and recalculates bounds on resize. [Renderer App](../src/renderer/App.tsx) switches between Home and Browser. [HomeGrid](../src/pages/home/HomeGrid.tsx) enables Browser and leaves eight feature cards disabled.

## 2. Navigation and state

[NavigationController](../src/main/browser/NavigationController.ts) trims input, searches Google when input contains whitespace, adds HTTPS when no scheme is supplied, and searches malformed URL input. It rejects empty input and non-HTTP(S) schemes. Back and Forward use `WebContents.navigationHistory`.

[BrowserManager](../src/main/browser/BrowserManager.ts) publishes URL, history availability, and loading state after navigation/loading events. It starts with the page hidden. Home hides the view without destroying history; reopening Browser shows it again. Reloading the trusted renderer also hides it. Home switching is not part of Chromium history.

[AddressBar](../src/renderer/browser/AddressBar.tsx) follows browser state while idle and preserves the user's draft while focused. [BrowserWorkspace](../src/renderer/browser/BrowserWorkspace.tsx) subscribes to state, invokes navigation, and displays errors.

## 3. Session and security

[BrowserManager](../src/main/browser/BrowserManager.ts) uses `persist:job-agent-browser`, allowing website storage to survive restarts. It installs a handler that denies permission requests. There is one shared session partition, with no implemented multi-profile selector.

- [Trusted window](../src/main/window.ts) and [remote view](../src/main/browser/BrowserManager.ts) disable Node integration and enable context isolation and sandboxing; remote web security remains enabled.
- [IPC handlers](../src/main/index.ts) check that the sender's webContents belongs to a BrowserWindow and validate navigation/visibility argument types. [Preload](../src/preload/index.ts) does not expose raw `ipcRenderer`.
- [Remote navigation](../src/main/browser/BrowserManager.ts) blocks non-HTTP(S) `will-navigate` events. Pop-ups are denied; HTTP(S) new-window links open in the operating-system browser, and other schemes are discarded.
- The [trusted HTML document](../src/renderer/index.html) sets a restrictive Content Security Policy; external pages are hosted separately.

The [data IPC handler](../src/platform/electron/main/data-ipc.ts) additionally requires the exact trusted renderer document and top frame. A fixed capability allowlist and domain input validation restrict data operations; raw SQL, audit writes and generation-stage writes are not exposed.

## 4. Business storage and limitations

[Main](../src/main/index.ts) opens the database and installs `window.data` handlers before creating the window, closing storage on quit. The [backend composition](../src/platform/database/backend.ts) injects repositories and transactions into Domain use cases and recovers interrupted generation attempts. Startup storage failure prevents the window from opening and reports a fixed error without resetting data.

SQLite migrations, business persistence, automatic content-free audit and typed business IPC are implemented; their rules and API are owned by [data architecture](data-architecture.md). [Integration tests](../tests/audit.test.ts) cover transaction/privacy guarantees; [Electron smoke](../scripts/smoke.cjs) verifies the built Main, sandboxed Preload and IPC. Validation commands are indexed in README.

[Application navigation](../src/app/navigation/navigate.ts), [context](../src/app/context/appContext.ts), [AI](../src/platform/ai/index.ts), and the target [App](../src/app/App.tsx) remain placeholders. Business pages remain disabled. Internal routing, combined history, Shared Context, page extraction, AI generation execution, compilation, settings/secrets persistence and installers are not implemented.

## 5. Related documents

- [README](../README.md): setup, validation, and documentation index.
- [Product architecture](product-architecture.md): planned scope and delivery order.
- [Code architecture](code-architecture.md): target organization and migration boundaries.
- [V1 data architecture and API](data-architecture.md): implemented persistence and business interfaces.
