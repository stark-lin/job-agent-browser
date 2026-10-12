const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const tokens = JSON.parse(read('src/shared/ui/design-tokens.json'))
const pixels = (name) => {
  assert(/^\d+px$/.test(tokens[name]), `${name}: expected a pixel dimension`)
  return Number.parseInt(tokens[name], 10)
}
const generated = {
  'src/shared/ui/design-tokens.css': '/* Generated from design-tokens.json: npm run design:tokens */\n:root {\n' +
    Object.entries(tokens).map(([name, value]) => `  --${name}: ${value};`).join('\n') + '\n}\n',
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
const html = read('docs/components/job-browser-component-library-8px.html')
assert.deepEqual([...html.matchAll(/<section class="section" id="([^"]+)"/g)].map((match) => match[1]),
  ['foundations', 'buttons', 'forms', 'navigation', 'badges', 'cards', 'job', 'feedback', 'overlays', 'tables'])
for (const [, inline] of html.matchAll(/style="([^"]+)"/g)) checkDeclarations(inline + ';', 'gallery inline style')
for (const [, href] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
  assert(fs.existsSync(path.resolve(root, 'docs/components', href)), `Gallery: missing asset ${href}`)
}
console.log('Design system checks passed: generated assets, 8px geometry, spacing tokens, semantic colors and 10 gallery categories.')
