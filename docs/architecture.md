# Browser Foundation Architecture

This document describes the Initial Commit implementation. It follows the scope in the supplied Job Agent Browser PRD: one browser workspace, one page view, native Chromium navigation history, and no Job Context or Agent behavior.

## Process boundaries

```text
React Renderer ── window.browser ── Preload ── IPC ── Main Process
                                                     ├── BrowserWindow
                                                     └── WebContentsView
                                                         └── persistent Session
```

- **Main** owns the app lifecycle, main window, `WebContentsView`, navigation, session, and browser state.
- **Preload** exposes only `navigate`, `back`, `forward`, `getState`, and `onStateChange` through `contextBridge`.
- **Renderer** draws the toolbar and tracks only editable address field state and the latest browser state.
- **WebContentsView** loads external sites in an isolated, sandboxed renderer with Node integration disabled.

The WebContentsView begins below the 64-pixel controls row. Main recalculates its bounds when the window resizes. This keeps third-party pages out of the React renderer and leaves the UI free to grow independently in later phases.

## Navigation and state

`NavigationController` trims address input. Inputs with whitespace are searched through Google. Other input is parsed as a URL, with HTTPS added when no scheme is supplied. Only HTTP and HTTPS are accepted; unsupported schemes are rejected. A malformed non-whitespace value is treated as a search term.

Back and Forward call the `WebContents.navigationHistory` API. The manager publishes URL, history availability, and loading state after navigation and loading events. The address input follows browser state while idle, but holds its draft while focused so redirects or history changes do not overwrite text being edited.

## Session and permissions

The page uses the `persist:job-agent-browser` session partition so cookies and other Chromium site storage can survive app restarts. There is one shared default profile. Permission requests are denied by default in this foundation; add a deliberate permission flow before enabling camera, microphone, geolocation, notifications, or similar capabilities.

## Security decisions

- Both trusted UI and remote page views disable Node integration, enable context isolation and sandboxing, and retain Chromium web security.
- IPC is exposed as named operations, never as raw `ipcRenderer`. Main checks that IPC senders belong to a BrowserWindow before handling requests.
- Address bar navigation and in-page top-level navigation are limited to HTTP and HTTPS.
- Pop-up windows are denied. HTTP(S) links requesting a new window are opened by the operating system browser; other schemes are discarded.
- The local React document has a restrictive Content Security Policy. It does not need to connect to websites because Main loads those into a separate view.

## Local development

Use Node.js 22.12 or newer and npm:

```sh
npm install
npm run dev
npm run typecheck
npm run build
```

The build emits app bundles to `out/`. Installers, signing, and distribution configuration are not part of this commit.

The `predev` script runs Electron's `install-electron` helper. Electron 44 ships its runtime binary separately from the npm package; this downloads it on the first development launch and skips the download once it is cached locally.
