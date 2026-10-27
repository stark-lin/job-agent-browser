const fs = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { execFileSync } = require('node:child_process')
const { metadata } = require('./release-metadata.cjs')
const root = resolve(__dirname, '..')
function distributionLock(pkg, original) {
  const packages = { '': { ...pkg } }
  delete packages[''].files; delete packages[''].publishConfig; delete packages[''].jab
  const pending = Object.entries(pkg.dependencies).map(([name]) => ['', name, false])
  while (pending.length) {
    const [parent, name, optional] = pending.pop()
    let location = parent, key
    for (;;) {
      key = (location ? location + '/' : '') + 'node_modules/' + name
      if (original.packages[key]) break
      if (!location) { if (optional) { key = null; break }; throw new Error('LOCK_DEPENDENCY_MISSING: ' + name) }
      location = location.includes('/node_modules/') ? location.slice(0, location.lastIndexOf('/node_modules/')) : ''
    }
    if (!key || packages[key]) continue
    const item = { ...original.packages[key] }
    delete item.dev; delete item.devOptional
    packages[key] = item
    const deps = { ...item.dependencies, ...item.optionalDependencies }
    for (const dependency of Object.keys(deps)) pending.push([key, dependency, Boolean(item.optionalDependencies?.[dependency])])
    for (const dependency of Object.keys(item.peerDependencies || {})) pending.push([key, dependency, Boolean(item.peerDependenciesMeta?.[dependency]?.optional)])
  }
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }
}
function prepare() {
  const source = require('../package.json'), original = require('../package-lock.json')
  const sha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const version = process.env.GITHUB_RUN_NUMBER ? metadata(source.version, process.env.GITHUB_RUN_NUMBER, sha).version : source.version + '-next.0'
  const pkg = { ...require('../packages/npm/package.template.json'), version, author: source.author,
    dependencies: {}, jab: { gitSha: sha, distribution: 'npm', modelRevision: require('../resources/embedding-model.json').revision } }
  for (const name of [...Object.keys(source.dependencies), 'electron']) {
    const entry = original.packages['node_modules/' + name]
    if (!entry?.version) throw new Error('LOCK_DIRECT_DEPENDENCY_MISSING: ' + name)
    pkg.dependencies[name] = entry.version
  }
  const output = join(root, 'dist/npm')
  fs.rmSync(output, { recursive: true, force: true }); fs.mkdirSync(output, { recursive: true })
  for (const name of ['main/index.js', 'main/application-main.js', 'main/job-agent-mcp.js', 'main/resume-output-worker.js', 'main/embedding-process.js', 'main/pdf-worker.mjs', 'main/fonts/NotoSansSC.ttf', 'main/skills', 'preload/index.js', 'renderer/index.html']) {
    if (!fs.existsSync(join(root, 'out', name))) throw new Error('BUILD_RESOURCE_MISSING: ' + name)
  }
  for (const name of ['out', 'packages/npm/bin']) fs.cpSync(join(root, name), join(output, name === 'out' ? name : 'bin'), { recursive: true })
  fs.mkdirSync(join(output, 'resources'))
  for (const name of ['embedding-model.json', 'model-notice.txt']) fs.copyFileSync(join(root, 'resources', name), join(output, 'resources', name))
  for (const name of ['README.md', 'README.zh-CN.md']) fs.copyFileSync(join(root, 'packages/npm', name), join(output, name))
  fs.copyFileSync(join(root, 'LICENSE'), join(output, 'LICENSE'))
  fs.writeFileSync(join(output, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(join(output, 'npm-shrinkwrap.json'), JSON.stringify(distributionLock(pkg, original), null, 2) + '\n')
  fs.chmodSync(join(output, 'bin/jab.cjs'), 0o755)
  console.log(`Prepared ${pkg.name}@${version} at ${output}`)
  return output
}
module.exports = { prepare, distributionLock }
if (require.main === module) prepare()
