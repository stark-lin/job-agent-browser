const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name)
    return entry.isDirectory() ? files(name) : [name]
  })
}
const sourceFiles = files(path.join(root, 'src')).filter((file) => /\.tsx?$/.test(file))
const graph = new Map()
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const text = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imports = ast.statements.filter((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)).filter((node) => node.moduleSpecifier)
  const runtimeEdges = []
  for (const node of imports) {
    const module = node.moduleSpecifier.text
    const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly
    const resolved = module.startsWith('.') ? path.resolve(path.dirname(file), module)
      : module.startsWith('@shared/') ? path.resolve(root, 'src/shared', module.slice(8)) : module
    const destination = path.relative(root, resolved).replaceAll('\\', '/')
    if (relative.startsWith('src/domain/')) {
      assert(module.startsWith('.') && destination.startsWith('src/domain/'), `${relative}: Domain must depend only on domain contracts/utilities`)
    }
    if (relative.startsWith('src/shared/')) {
      assert(!/^src\/(domain|platform|app|pages|renderer)\//.test(destination), `${relative}: Shared must have no business/platform dependency`)
    }
    if (/^src\/(app|renderer|pages)\//.test(relative) && !typeOnly) {
      assert(!/^src\/(main|preload|platform)\//.test(destination), `${relative}: UI cannot import privileged runtime code`)
      assert(!destination.includes('.service') && !destination.includes('.repository'), `${relative}: UI must call the public bridge`)
      assert(!module.startsWith('node:') && module !== 'electron', `${relative}: privileged import`)
    }
    if (!typeOnly && (module.startsWith('.') || module.startsWith('@shared/'))) {
      const target = [resolved + '.ts', resolved + '.tsx', path.join(resolved, 'index.ts'), path.join(resolved, 'index.tsx')].find((candidate) => sourceFiles.includes(candidate))
      if (target) runtimeEdges.push(target)
    }
  }
  if (/^src\/(domain|platform\/database|platform\/electron)\//.test(relative)) {
    assert(text.split('\n').length <= 250, `${relative}: split modules larger than 250 lines`)
    const visit = (node) => {
      assert(node.kind !== ts.SyntaxKind.AnyKeyword, `${relative}: avoid any at data boundaries`)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  graph.set(file, runtimeEdges)
}
const visiting = new Set(), visited = new Set()
function walk(file) {
  assert(!visiting.has(file), `Runtime import cycle: ${path.relative(root, file)}`)
  if (visited.has(file)) return
  visiting.add(file)
  for (const next of graph.get(file) ?? []) walk(next)
  visiting.delete(file); visited.add(file)
}
for (const file of graph.keys()) walk(file)

const editions = files(root + '/docs').filter((file) => file.endsWith('.md') && !file.includes('/diagrams/')).concat([root + '/README.md', root + '/README.zh-CN.md', root + '/AGENTS.md', root + '/AGENTS.zh-CN.md'])
for (const file of editions) {
  const body = fs.readFileSync(file, 'utf8'), chinese = file.endsWith('.zh-CN.md')
  const other = chinese ? file.replace('.zh-CN.md', '.md') : file.replace('.md', '.zh-CN.md')
  assert(fs.existsSync(other), `${file}: missing language counterpart`)
  const counterpart = fs.readFileSync(other, 'utf8')
  assert(body.includes(path.basename(other)), `${file}: missing reciprocal language link`)
  assert.equal((body.match(/^#{1,3} /gm) ?? []).length, (counterpart.match(/^#{1,3} /gm) ?? []).length, `${file}: section parity`)
  assert(body.split('\n').length <= (path.basename(file).startsWith('README') ? 120 : 200), `${file}: document length`)
  assert(!/^#{4,} /m.test(body), `${file}: too many heading levels`)
  const code = (text) => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1])
  assert.deepEqual(code(body), code(counterpart), `${file}: code/example parity`)
  for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1].split('#')[0]
    if (link && !/^[a-z]+:/i.test(link)) assert(fs.existsSync(path.resolve(path.dirname(file), link)), `${file}: broken link ${link}`)
  }
}
console.log(`Quality checks passed: ${sourceFiles.length} sources; dependency boundaries, cycles, module size, types and bilingual documentation.`)
