# Current Runtime Architecture

Purpose: record verified runtime behavior. Status: **Implemented** browser foundation and Home; business workflows remain **Planned**, with selected modules **Scaffolded**.

Language: English · [简体中文](architecture.zh-CN.md)

## 1. Runtime and process boundaries

[Build configuration](../electron.vite.config.ts) selects [Main](../src/main/index.ts), [Preload](../src/preload/index.ts), and the [Renderer HTML entry](../src/renderer/index.html). The [package entry](../package.json) points to `out/main/index.js`.

```text
React Renderer → window.browser → Preload → IPC → Main
                                                  ├── BrowserWindow
                                                  └── WebContentsView → Session
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

These describe existing checks, not a complete future security contract. New privileged APIs require appropriate sender, frame, origin, and input validation.

## 4. Scaffold and limitations

[Application navigation](../src/app/navigation/navigate.ts), [context](../src/app/context/appContext.ts), [Job types](../src/domain/job/job.types.ts), [SQLite](../src/platform/database/sqlite.ts), [migrations](../src/platform/database/migrations/index.ts), and [AI](../src/platform/ai/index.ts) are placeholders, not active implementations. Home is the implemented page used by the current Renderer; the target entry [src/app/App.tsx](../src/app/App.tsx) is still a placeholder.

Internal `app://` routing, combined internal/external history, Shared Context, job extraction, profile storage, generation, compilation, audit, settings, and secrets storage are not wired into the runtime. The ER diagram does not create tables or migrations. [package.json](../package.json) defines no automated test command or installer configuration; type checking and build commands are documented in the README.

## 5. Related documents

- [README](../README.md): setup, validation, and documentation index.
- [Product architecture](product-architecture.md): planned scope and delivery order.
- [Code architecture](code-architecture.md): target organization and migration boundaries.
- [V1 data architecture](data-architecture.md): planned persistence and generation design.
