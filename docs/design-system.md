# Design system

Language [English](design-system.md) · [简体中文](design-system.zh-CN.md)

Astryx 0.7.7 is the desktop renderer's general-purpose UI system. Phase 1 preserves page structure and order, copy and interactions. Phase 2 plans page rearrangement and copy improvements.

## Component ownership

Pages and feature components import Astryx directly. Use Astryx component props and semantic tokens for presentation and local CSS for layout. Purpose-built UI, such as the Knowledge tree and CodeMirror editor, belongs to its feature. The former JAB component library and generated skins have been removed.

The [renderer entry](../src/renderer/main.tsx) loads the reset, component CSS and Neutral theme CSS in that order. The [theme provider](../src/app/theme.tsx) applies the Electron Main theme snapshot and uses system mode before it arrives.

## Native surfaces

The permanent icon-only sidebar uses 8px between items within a group and 12px between groups. It shows tooltips and the active page and keeps Settings at the bottom. Its 48px width comes from the same geometry that positions the Browser and Inbox native views. [SideNav](../src/app/WorkspaceSidebar.tsx) · [Shared geometry](../src/shared/geometry.ts) · [Browser manager](../src/platform/browser/browserManager.ts)

Electron owns the [Smart Paste banner](../src/platform/banner/bannerView.ts), [history indicator](../src/platform/browser/historyIndicator.ts) and [native tooltip](../src/platform/browser/navigationTooltip.ts). Their standalone documents use a [Neutral palette](../src/platform/electron/nativeTheme.css) and retain their own event and security boundaries.

## Verification

Run the type, quality, unit and Electron smoke checks.

```sh
npm run typecheck
npm run quality
npm test
npm run test:smoke
```
