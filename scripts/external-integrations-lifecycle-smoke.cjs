const assert = require('node:assert/strict')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

module.exports = async function lifecycleSmoke({ evaluate, waitFor, capture }) {
  const targets = ['codex', 'claude-code', 'cursor']
  const names = ['capture-job', 'manage-applications', 'tailor-resume']
  const api = (kind, method, input) => evaluate(`window.${kind}.${method}(${JSON.stringify(input)})`)
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const ready = () => waitFor(() => evaluate('!document.querySelector("[data-mcp-refresh]").disabled'), 'lifecycle action finished')
  const confirm = async button => {
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(button)}).closest('dialog').open`), 'lifecycle confirmation')
    assert(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button)}).closest('dialog').querySelector('button')`))
    await click(button)
  }
  const cancel = async button => {
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(button)}).closest('dialog').open`), 'cancellation dialog')
    assert(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button)}).closest('dialog').querySelector('button')`))
    await evaluate(`document.querySelector(${JSON.stringify(button)}).closest('dialog').querySelector('button').click()`)
  }
  const inspected = (await api('externalMCP', 'inspect', {})).value
  const skills = (await api('externalSkills', 'inspect', {})).value
  for (const row of [...inspected.clients, ...skills.clients]) assert(row.path.startsWith(resolve(process.env.JOB_BROWSER_SMOKE_DATA, 'agent-home')))
  for (const target of targets) {
    const selector = `[data-agent-target="${target}"]`
    const before = (await api('externalMCP', 'inspect', {})).value.clients.find(row => row.target === target)
    await click(`${selector} [data-mcp-reconnect]`)
    await ready()
    assert(await evaluate(`document.querySelector('${selector}').textContent.includes('MCP configuration refreshed and a new connection verified')`))
    const after = (await api('externalMCP', 'inspect', {})).value.clients.find(row => row.target === target)
    assert.notEqual(after.revision, before.revision)
    const body = readFileSync(after.path, 'utf8')
    await click(`${selector} [data-mcp-remove]`)
    await cancel('[data-mcp-remove-confirm]')
    assert.equal(readFileSync(after.path, 'utf8'), body)
    if (target === 'codex') {
      await click(`${selector} [data-mcp-remove]`)
      writeFileSync(after.path, `${body}\n# changed while confirmation was open\n`)
      await confirm('[data-mcp-remove-confirm]'); await ready()
      assert.equal((await api('externalMCP', 'inspect', {})).value.clients.find(row => row.target === target).state, 'configured')
      assert(await evaluate(`document.querySelector('${selector}').textContent.includes('The configuration changed')`))
    }
    await click(`${selector} [data-mcp-remove]`)
    await confirm('[data-mcp-remove-confirm]'); await ready()
    assert.equal((await api('externalMCP', 'inspect', {})).value.clients.find(row => row.target === target).state, 'missing')
    assert((await api('externalSkills', 'inspect', {})).value.clients.find(row => row.target === target).skills.every(skill => skill.state === 'installed'))
    assert(await evaluate(`document.querySelector('${selector} [data-mcp-test]').disabled`))
    await click(`${selector} [data-mcp-install]`); await ready()
  }
  const mcpBefore = inspected.clients.map(row => readFileSync(row.path, 'utf8'))
  for (const target of targets) {
    const selector = `[data-agent-skills="${target}"]`
    const before = (await api('externalSkills', 'inspect', {})).value.clients.find(row => row.target === target)
    await click(`${selector} [data-skills-reconnect]`); await ready()
    assert.notEqual((await api('externalSkills', 'inspect', {})).value.clients.find(row => row.target === target).revision, before.revision)
    await click(`${selector} [data-skill-remove="capture-job"]`)
    await cancel('[data-skills-remove-confirm]')
    assert(existsSync(join(before.path, 'capture-job')))
    if (target === 'codex') {
      await click(`${selector} [data-skill-remove="capture-job"]`)
      writeFileSync(join(before.path, 'capture-job', 'SKILL.md'), 'changed while confirmation was open')
      await confirm('[data-skills-remove-confirm]'); await ready()
      assert(existsSync(join(before.path, 'capture-job')))
      assert(await evaluate(`document.querySelector('${selector}').textContent.includes('Skills or the destination changed')`))
      await click(`${selector} [data-skills-reconnect]`)
      await confirm('[data-skills-confirm]'); await ready()
    }
    await click(`${selector} [data-skill-remove="capture-job"]`)
    await confirm('[data-skills-remove-confirm]'); await ready()
    assert(!existsSync(join(before.path, 'capture-job')))
    assert(existsSync(join(before.path, 'manage-applications')))
    assert(await evaluate(`document.querySelector('${selector}').textContent.includes('Selected Skills deleted')`))
    const unrelated = join(before.path, 'unrelated')
    mkdirSync(unrelated, { recursive: true }); writeFileSync(join(unrelated, 'SKILL.md'), 'retained')
    await click('[data-mcp-refresh]'); await ready()
    await click(`${selector} [data-skills-remove]`)
    if (target === 'codex') await capture('external-skills-delete-confirmation.png')
    await confirm('[data-skills-remove-confirm]'); await ready()
    assert(names.every(name => !existsSync(join(before.path, name))))
    assert.equal(readFileSync(join(unrelated, 'SKILL.md'), 'utf8'), 'retained')
    await click(`${selector} [data-skills-install]`); await ready()
    assert((await api('externalSkills', 'inspect', {})).value.clients.find(row => row.target === target).skills.every(skill => skill.state === 'installed'))
  }
  inspected.clients.forEach((row, index) => assert.equal(readFileSync(row.path, 'utf8'), mcpBefore[index]))
  console.log('Integration lifecycle smoke passed: fresh MCP discovery, confirmed removal/reinstall, Skill reinstall/selective/all removal, stale confirmations, cancellation and unrelated content retention for all three Agents.')
}
