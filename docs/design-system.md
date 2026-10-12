# Component Library and Design System

Purpose: define the shared UI rules and downloadable reference library. Status: **Implemented** tokens, CSS gallery, central React primitives and their use by Home, Browser and placeholder pages. The gallery demonstrates ten categories; it does not implement the planned business workflows or a React component for every example.

Language: English · [简体中文](design-system.zh-CN.md)

## 1. Reference and assets

Open the [8px component library](components/job-browser-component-library-8px.html) in a browser. It retains Foundations, Buttons, Forms, Navigation, Badges & chips, Cards, Job components, Feedback, Overlays and Tables, with spacing rulers and control-size examples. The supplied HTML was imported as a visual reference; sample jobs, secrets guidance and example actions do not establish application behavior.

- [Standalone component CSS](components/job-browser-component-library-8px.css): generated gallery layout and component styles with tokens included; usable as a single CSS file.
- [Tokens CSS](../src/shared/ui/design-tokens.css): CSS custom properties, shared with the application.
- [Tokens JSON](../src/shared/ui/design-tokens.json): canonical flat map of token names to CSS values; includes neutral surfaces, semantic colors, spacing, geometry and type. These are plain CSS tokens, not a DTCG interchange schema.

The gallery provides download links for all three assets and needs no build or external fonts. Save the HTML and standalone CSS together for offline viewing. The application imports central runtime styles and tokens through the [Renderer entry](../src/renderer/main.tsx); gallery styles are kept outside the application bundle.

## 2. Mandatory central component reuse

All application UI components must reuse the [central public entry](../src/shared/ui/index.ts). Page and domain components compose shared primitives; semantic HTML for page structure is allowed. Adding only token references does not satisfy the reuse requirement.

- **Implemented:** `Button`, `IconButton`, `TextInput`, `Icon`, `IconBox`, `FeatureCard` and `PlaceholderPage`, with [central runtime styles](../src/shared/ui/components.css). Existing feature actions, browser controls/address/tabs and Home cards/icons consume these components.
- Add any missing primitive or variant to `src/shared/ui/` and export it from `index.ts` before using it in a page. Gallery-only examples still need a central React implementation before application use.
- Keep reusable appearance, sizes, states and accessibility defaults in the central library. Page CSS may arrange components, using shared tokens; it must not redefine their skin, copy central selectors or use inline styles to bypass the library.
- Pages retain business data, placement, enabled/loading state, navigation and event handlers. The central library must not import App/Page/Domain/Platform behavior; use props and composition slots.

The [quality checker](../scripts/quality.cjs) rejects native reusable controls/icons and inline JSX styles outside the library, and requires UI imports through the public entry. The design checker rejects central `.ui-*` selectors in page/application styles. These checks cover common bypasses; review must also catch duplicated appearance under different class names.

## 3. Layout, geometry and typography

| Item | Required scale or size |
| --- | --- |
| Spacing | 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px; zero is allowed |
| Controls | Small 32px / default 40px / large 48px |
| Toolbar | 48px |
| Browser tab strip | 48px; total browser chrome 96px |
| List row | 64px minimum; grow for content when necessary |
| Home card | 144px minimum at every viewport size |
| Icons | 16px in 32px / 40px containers |
| Corners | 8 / 16 / 24px |
| Font sizes | 12 / 14 / 16 / 20 / 32 / 40px |
| Line heights | 16 / 24 / 32 / 40 / 48px |
| Borders and separators | 1px |
| Focus outline | 2px |

Use `--space-*` for all nonzero padding, gap and margin. Use geometry tokens for fixed component dimensions and type tokens for font size and line height. Numeric zero, `auto`, percentages and flexible grid tracks are allowed where appropriate; do not use viewport-based padding that breaks the spacing scale. The `--space-N` suffix counts 8px steps, not pixels; unlisted steps such as 56px are excluded.

Font sizes and stroke widths are exceptions to the grid. Circular dots and loading indicators use `50%` rounding; rectangular controls, chips and badges use the corner scale. SVG paths and stroke widths describe glyphs rather than layout. Responsive widths and breakpoints do not imply every fluid rendered width is divisible by eight.

Center icons with grid/flex alignment. Give text its fixed token line height, allow labels and descriptions to wrap, and preserve minimum card height on narrow screens. Borders use `box-sizing: border-box`. Focus outlines remain visible, and loading/hover motion respects reduced-motion preferences. See [Home styles](../src/pages/home/home.css), [application styles](../src/renderer/styles/global.css) and [reference styles](../src/shared/ui/component-library.css).

## 4. Semantic color rules

| Meaning | Token | Color | Usage |
| --- | --- | --- | --- |
| Action / information | `--primary`, `--info` | `#2563eb` | Primary action, active navigation, informational state |
| Success | `--success` | `#16a34a` | Completed operation, ready artifact, offer |
| Warning | `--warning` | `#d97706` | Needs review or attention |
| Error / destructive | `--danger` | `#dc2626` | Failed operation, invalid field, destructive action |

Use the matching background and border tokens for each semantic state. Prefer one clear primary action per task. Saved/Closed stages stay neutral; Applied/Interview use information styling. A stage is not automatically a warning or error. Include text or an icon so meaning does not depend on color alone.

## 5. Maintenance and verification

Edit `design-tokens.json` or [reference component styles](../src/shared/ui/component-library.css), then regenerate the CSS exports and [shared browser geometry](../src/shared/ui/geometry.ts):

```sh
npm run design:tokens
npm run design:check
```

The [design-system checker](../scripts/design-system.cjs) verifies generated-file consistency, approved spacing, fixed geometry, token references, semantic colors, asset paths and all ten gallery categories. It runs inside `npm run quality` and therefore `npm run check`. It checks declared dimensions, not every computed layout or accessibility contrast ratio.

The [browser contract](../src/shared/browser.ts) re-exports generated geometry used by [native-view layout](../src/platform/browser/browserManager.ts). Do not independently change toolbar heights in CSS or Main. [Browser smoke](../scripts/browser-smoke.cjs) compares rendered chrome against native bounds; it also checks card sizing and responsive layout. Application validation commands are owned by [README](../README.md#validation-and-build).

## 6. Related documents

- [Current architecture](architecture.md): runtime behavior and remaining limitations.
- [Code architecture](code-architecture.md): dependency boundaries and page ownership.
- [Product architecture](product-architecture.md): planned workflows represented by gallery examples.
