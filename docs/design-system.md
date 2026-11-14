# Design system

Language [English](design-system.md) · [简体中文](design-system.zh-CN.md)

Astryx 0.7.7 is the desktop renderer's general-purpose UI system. Phase 1 preserves page structure and order, copy and interactions. Phase 2 plans page rearrangement and copy improvements.

## Component ownership

Pages and feature components import Astryx directly. Use Astryx component props and semantic tokens for presentation and local CSS for layout. Purpose-built UI, such as the Knowledge tree and CodeMirror editor, belongs to its feature. The former JAB component library and generated skins have been removed.

The [renderer entry](../src/renderer/main.tsx) loads the reset, component CSS and Neutral theme CSS in that order. The [theme provider](../src/app/theme.tsx) applies the Electron Main theme snapshot and uses system mode before it arrives.

## Native surfaces

The [SideNav](../src/app/WorkspaceSidebar.tsx) has a permanent icon-only layout with tooltips, active page indication and Settings at the bottom. Shared [geometry](../src/shared/geometry.ts) defines its 72px width and the Browser chrome height. The [browser manager](../src/platform/browser/browserManager.ts) places both native web surfaces at the right edge of the rail.

Electron owns the [Smart Paste banner](../src/platform/banner/bannerView.ts), [history indicator](../src/platform/browser/historyIndicator.ts) and [native tooltip](../src/platform/browser/navigationTooltip.ts). Their standalone documents use a [Neutral palette](../src/platform/electron/nativeTheme.css) and retain their own event and security boundaries.

## Verification

Run the type, quality, unit and Electron smoke checks.

```sh
npm run typecheck
npm run quality
npm test
npm run test:smoke
```
