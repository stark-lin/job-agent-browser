const assert = require('node:assert/strict')
const { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { shell } = require('electron')

module.exports = async function externalSkillsSmoke({ window, evaluate, waitFor }) {
  const names = ['capture-job', 'manage-applications', 'tailor-resume']
  const bundle = resolve(__dirname, '../out/main/skills')
  const api = (method, input) => evaluate(`window.externalSkills.${method}(${JSON.stringify(input)})`)
  const selector = target => `[data-agent-skills="${target}"]`
  const click = target => evaluate(`document.querySelector('${selector(target)} [data-skills-install]').click()`)
  const ready = () => waitFor(() => evaluate('document.querySelectorAll("[data-agent-skills]").length === 3 && !document.querySelector("[data-mcp-refresh]").disabled'), 'Skills controls ready')
  const refresh = async () => { await evaluate('document.querySelector("[data-mcp-refresh]").click()'); await ready() }
  await ready()
  const before = await api('inspect', {})
  assert(before.ok)
  assert.deepEqual(await api('inspect', { path: '/arbitrary' }), { ok: false, error: 'INVALID_INPUT' })
  for (const client of before.value.clients) {
    assert(client.path.startsWith(resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'agent-home')))
    assert(client.skills.every(skill => skill.state === 'missing'))
    assert.equal(existsSync(client.path), false)
  }
  const codex = before.value.clients.find(client => client.target === 'codex')
  const source = join(bundle, 'capture-job', 'SKILL.md')
  assert(readFileSync(source, 'utf8').includes('name: capture-job'))
  // An existing symlink is replaced as an entry; its external files must survive.
  const external = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'custom Skill')
  mkdirSync(external); writeFileSync(join(external, 'SKILL.md'), 'custom content')
  mkdirSync(codex.path, { recursive: true })
  symlinkSync(external, join(codex.path, 'capture-job'), 'dir')
  await refresh(); await click('codex')
  await waitFor(() => evaluate('document.querySelector("[data-skills-confirm]").closest("dialog").open'), 'Skills replacement dialog')
  assert(await evaluate('document.querySelector("[data-skills-confirm]").closest("dialog").textContent.includes("capture-job")'))
  assert(await evaluate('document.activeElement === document.querySelector("[data-skills-confirm]").closest("dialog").querySelector("button")'))
  await evaluate('document.querySelector("[data-skills-confirm]").closest("dialog").querySelector("button").click()')
  assert(lstatSync(join(codex.path, 'capture-job')).isSymbolicLink())
  assert.equal(existsSync(join(codex.path, 'manage-applications')), false)
  await click('codex')
  await evaluate('document.querySelector("[data-skills-confirm]").click()')
  await ready()
  assert.equal(readFileSync(join(external, 'SKILL.md'), 'utf8'), 'custom content')

  for (const client of before.value.clients) {
    if (client.target !== 'codex') { await click(client.target); await ready() }
    const installed = (await api('inspect', {})).value.clients.find(row => row.target === client.target)
    assert(installed.skills.every(skill => skill.state === 'installed'))
    assert.deepEqual(readdirSync(client.path).sort(), [...names].sort(), 'No backups or staging folders remain')
    for (const name of names) for (const file of ['SKILL.md', 'SKILL.zh-CN.md']) {
      assert.deepEqual(readFileSync(join(client.path, name, file)), readFileSync(join(bundle, name, file)))
      assert(!lstatSync(join(client.path, name)).isSymbolicLink())
      assert(!readFileSync(join(client.path, name, file), 'utf8').includes('../../'), 'Standalone Skills do not link to repository files')
    }
    const modified = statSync(join(client.path, 'capture-job', 'SKILL.md')).mtimeMs
    const repeated = await api('install', { target: client.target, revision: installed.revision, replace: false })
    assert.deepEqual(repeated.value.completed, [])
    assert.equal(modified, statSync(join(client.path, 'capture-job', 'SKILL.md')).mtimeMs)
    assert.equal(await evaluate(`document.querySelector('${selector(client.target)} [data-skills-install]').disabled`), true)
  }
  const stale = (await api('inspect', {})).value.clients[0]
  writeFileSync(join(codex.path, 'capture-job', 'SKILL.md'), 'edited after inspection')
  const conflict = await api('install', { target: 'codex', revision: stale.revision, replace: true })
  assert.equal(conflict.value.error, 'SKILLS_CHANGED')
  assert.deepEqual(conflict.value.completed, [])
  await refresh(); await click('codex'); await evaluate('document.querySelector("[data-skills-confirm]").click()'); await ready()

  // Permission failure is shown in the production UI, with no false success.
  if (process.getuid?.() !== 0) {
    const path = before.value.clients.find(client => client.target === 'cursor').path
    rmSync(join(path, 'tailor-resume'), { recursive: true })
    chmodSync(path, 0o500)
    try {
      await refresh(); await click('cursor'); await ready()
      assert(await evaluate(`document.querySelector('${selector('cursor')}').textContent.includes('Unable to finish installing Skills')`))
      assert(await evaluate(`document.querySelector('${selector('cursor')}').textContent.includes('Still to install: tailor-resume')`))
    } finally { chmodSync(path, 0o700) }
    await refresh(); await click('cursor'); await ready()
  }
  // Open only the fixed built directory; avoid opening a real Finder window in tests.
  const originalOpen = shell.openPath
  let opened
  shell.openPath = async path => { opened = path; return '' }
  try {
    await evaluate('document.querySelector("[data-skills-open]").click()'); await ready()
    assert.equal(opened, bundle)
    assert(await evaluate('document.querySelector("[data-agent-target=other]").textContent.includes("Skills folder opened")'))
  } finally { shell.openPath = originalOpen }

  // Built resources remain independently usable after copying to a non-repository location.
  const standalone = resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'standalone bundle')
  cpSync(bundle, standalone, { recursive: true })
  for (const name of names) assert(readFileSync(join(standalone, name, 'SKILL.md'), 'utf8').includes(`name: ${name}`))
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload() })
  await ready()
  assert((await api('inspect', {})).value.clients.every(client => client.skills.every(skill => skill.state === 'installed')))
  console.log('External Skills smoke passed: bundled bilingual resources, real IPC/UI, cancel/replace without backups, symlink protection, repeat install, stale revision, failure feedback and reload.')
}
