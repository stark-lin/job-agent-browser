const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const tokens = JSON.parse(read('src/shared/ui/design-tokens.json'))
const darkTokens = JSON.parse(read('src/shared/ui/design-tokens.dark.json'))
const colorValue = (value, palette, seen = new Set()) => {
  if (typeof value !== 'string') return false
  const alias = /^var\(--([\w-]+)\)$/.exec(value)
  if (!alias) return /^(#[\da-f]{6}|rgba?\([\d.,\s]+\))$/i.test(value)
  if (seen.has(alias[1])) return false
  seen.add(alias[1])
  return colorValue(palette[alias[1]], palette, seen)
}
// Dark overrides may contain colors, aliases or shadows with identical geometry only.
for (const [name, value] of Object.entries(darkTokens)) {
  assert(name in tokens, `${name}: dark theme must override an existing token`)
  if (/shadow/.test(name)) {
    const geometry = text => text.replace(/rgba?\([^)]*\)|#[\da-f]+/gi, 'COLOR')
    assert.equal(geometry(value), geometry(tokens[name]), `${name}: themes must preserve shadow geometry`)
  } else {
    assert(colorValue(value, { ...tokens, ...darkTokens }) && colorValue(tokens[name], tokens), `${name}: themes may change colors only`)
  }
}
const darkDeclarations = Object.entries(darkTokens).map(([name, value]) => `  --${name}: ${value};`).join('\n')
const luminance = color => {
  assert(/^#[\da-f]{6}$/i.test(color), `Contrast checks require opaque hex colors: ${color}`)
  const channels = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
  return channels.reduce((total, channel, index) => total + [0.2126, 0.7152, 0.0722][index] *
    (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0)
}
for (const [foreground, background] of [['text', 'bg'], ['text', 'surface'], ['muted', 'surface'],
  ['primary', 'primary-soft'], ['danger', 'surface'], ['danger', 'danger-bg'], ['success', 'success-bg'],
  ['warning', 'warning-bg'], ['on-primary', 'primary'], ['on-primary', 'primary-hover']]) {
  const [low, high] = [luminance(darkTokens[foreground]), luminance(darkTokens[background])].sort((a, b) => a - b)
  assert((high + 0.05) / (low + 0.05) >= 4.5, `${foreground}/${background}: dark text contrast must reach 4.5:1`)
}
const pixels = (name) => {
  assert(/^\d+px$/.test(tokens[name]), `${name}: expected a pixel dimension`)
  return Number.parseInt(tokens[name], 10)
}
const generated = {
  'src/shared/ui/design-tokens.css': '/* Generated from design-tokens.json: npm run design:tokens */\n:root {\n' +
    '  color-scheme: light;\n' + Object.entries(tokens).map(([name, value]) => `  --${name}: ${value};`).join('\n') + '\n}\n' +
    '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;\n' +
    darkDeclarations.replace(/^/gm, '  ') + '\n  }\n}\n' +
    ':root[data-theme="dark"] {\n  color-scheme: dark;\n' + darkDeclarations + '\n}\n',
  'src/shared/ui/theme-colors.ts': '// Generated from design-tokens.json and design-tokens.dark.json: npm run design:tokens\n' +
    `export const themeBackgrounds = ${JSON.stringify({ light: tokens.bg, dark: darkTokens.bg })} as const\n`,
  'src/shared/ui/geometry.ts': '// Generated from design-tokens.json: npm run design:tokens\n' +
    `export const TAB_STRIP_HEIGHT = ${pixels('tab-strip-height')}\n` +
    `export const TOOLBAR_HEIGHT = ${pixels('toolbar-height')}\n` +
    'export const BROWSER_CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT\n' +
    `export const SIDEBAR_WIDTH = ${pixels('sidebar-width')}\n` +
    `export const SIDEBAR_COMPACT_WIDTH = ${pixels('sidebar-compact-width')}\n` +
    `export const SIDEBAR_BREAKPOINT = ${pixels('sidebar-breakpoint')}\n` +
    'export const getSidebarWidth = (width: number): number => width <= SIDEBAR_BREAKPOINT ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_WIDTH\n',
  'src/shared/ui/sidebar-responsive.css': '/* Generated from design-tokens.json: npm run design:tokens */\n' +
    `@media (max-width: ${pixels('sidebar-breakpoint')}px) {\n` +
    '  :root { --sidebar-current-width: var(--sidebar-compact-width); }\n' +
    '  .ui-sidebar-brand-label, .ui-navigation-label, .ui-navigation-group-title { display: none; }\n' +
    '  .ui-sidebar-brand, .ui-navigation-item { justify-content: center; }\n' +
    '}\n'
}
generated['docs/components/job-browser-component-library-8px.css'] =
  generated['src/shared/ui/design-tokens.css'] + '\n' +
  read('src/shared/ui/component-library.css').replace('@import "./design-tokens.css";\n', '')
for (const [file, content] of Object.entries(generated)) {
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, file), content)
  else assert.equal(read(file), content, `${file}: regenerate with npm run design:tokens`)
}
assert.equal(pixels('browser-chrome-height'), pixels('tab-strip-height') + pixels('toolbar-height'))
for (const [name, size] of Object.entries({
  'control-sm': 32, 'control-md': 40, 'control-lg': 48, 'toolbar-height': 48,
  'tab-strip-height': 48, 'list-row-height': 64, 'feature-card-height': 144,
  'icon-size': 16, 'icon-box': 32, 'icon-box-lg': 40, 'sidebar-width': 208, 'sidebar-compact-width': 64, 'sidebar-breakpoint': 960
})) assert.equal(pixels(name), size, `${name}: keep the component sizing standard`)
assert.deepEqual(['font-xs', 'font-sm', 'font-md', 'font-lg', 'font-xl', 'font-display'].map(pixels), [12, 14, 16, 20, 32, 40])
assert.deepEqual(['line-xs', 'line-sm', 'line-md', 'line-lg', 'line-xl', 'line-display'].map(pixels), [16, 24, 24, 32, 40, 48])
assert.deepEqual(['radius-sm', 'radius-md', 'radius-lg', 'radius-xl'].map(pixels), [8, 8, 16, 24])
assert.equal(pixels('border-width'), 1)
assert.equal(pixels('focus-width'), 2)
assert.deepEqual(Object.entries(tokens).filter(([name]) => /^space-/.test(name)).map(([, value]) => Number.parseInt(value)),
  [0, 8, 16, 24, 32, 40, 48, 64, 80, 96], 'Only the approved spacing scale is allowed')
assert.deepEqual(['primary', 'success', 'warning', 'danger'].map((name) => tokens[name]),
  ['#2563eb', '#16a34a', '#d97706', '#dc2626'], 'Preserve the semantic color palette')
for (const [name, value] of Object.entries(tokens)) {
  if (/^\d+px$/.test(value) && !/^(font-|border-width$|focus-width$)/.test(name)) {
    assert.equal(Number.parseInt(value) % 8, 0, `${name}: geometry must follow the 8px grid`)
  }
}

function checkDeclarations(body, file) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, property, value] of clean.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?:;|(?=\}))/g)) {
    if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(property)) {
      assert(!/\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)/.test(value), `${file}: ${property} must use spacing tokens`)
      for (const [, name] of value.matchAll(/var\(--([\w-]+)\)/g)) {
        assert(name.startsWith('space-'), `${file}: ${property} must use space tokens`)
      }
    }
    if (/^(width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|flex|flex-basis|grid-template-columns|grid-template-rows|border-radius|transform)$/.test(property)) {
      for (const [, number] of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        assert.equal(Number(number) % 8, 0, `${file}: ${property}: ${value} breaks the grid`)
      }
    }
    for (const [, name] of value.matchAll(/var\(--([\w-]+)\)/g)) {
      assert(name in tokens || ['bar-width', 'block-height'].includes(name), `${file}: unknown token --${name}`)
    }
  }
}
function sourceStyles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? sourceStyles(file) : file.endsWith('.css') ? [file] : []
  })
}
for (const file of sourceStyles('src')) {
  checkDeclarations(read(file), file)
  if (!file.startsWith('src/shared/ui/')) {
    assert(!/\.ui-[\w-]+/.test(read(file)), `${file}: central component selectors belong in src/shared/ui/`)
  }
}
assert(!/#[\da-f]{3,8}\b|rgba?\(|\b(?:background|color):\s*white\b/i.test(read('src/shared/ui/component-library.css')),
  'Gallery colors must use shared tokens')
const html = read('docs/components/job-browser-component-library-8px.html')
assert.deepEqual([...html.matchAll(/<section class="section" id="([^"]+)"/g)].map((match) => match[1]),
  ['foundations', 'buttons', 'forms', 'navigation', 'badges', 'cards', 'job', 'feedback', 'overlays', 'tables'])
for (const [, inline] of html.matchAll(/style="([^"]+)"/g)) checkDeclarations(inline + ';', 'gallery inline style')
for (const [, attribute, href] of html.matchAll(/(href|src)="([^"#][^"]*)"/g)) {
  if (attribute === 'href' && /^https?:\/\//.test(href)) continue
  assert(fs.existsSync(path.resolve(root, 'docs/components', href)), `Gallery: missing asset ${href}`)
}
console.log('Design system checks passed: generated assets, color-only themes, 8px geometry, spacing tokens, semantic colors and 10 gallery categories.')
