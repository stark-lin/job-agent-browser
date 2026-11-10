const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { runTestProcess, runTestFiles } = require('../scripts/test-process.cjs')

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'jab-test-deadline-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

for (const [name, body] of [
  ['unresolved test', "test('pending', async () => new Promise(() => {})); setInterval(() => {}, 1000)"],
  ['unresolved teardown', "test('cleanup', t => { t.after(() => new Promise(() => {})) }); setInterval(() => {}, 1000)"],
  ['leaked handle after success', "test('passed', () => {}); setInterval(() => {}, 1000)"],
  ['blocked event loop', "test('blocked', () => { while (true) {} })"]
]) test(`parent deadline kills ${name}`, { timeout: 5000 }, t => {
  const file = join(fixture(t), 'hanging.test.cjs')
  writeFileSync(file, `const test = require('node:test'); ${body}`)
  const result = runTestProcess(process.execPath, ['--test', '--test-isolation=none', '--test-timeout=60000', file],
    { timeout: 500, stdio: 'pipe' })
  assert.equal(result.error?.code, 'ETIMEDOUT')
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(result.status, null)
})

test('a timed-out file fails the suite and later test files still run', { timeout: 5000 }, t => {
  const directory = fixture(t), hanging = join(directory, 'hanging.test.cjs'), passing = join(directory, 'passing.test.cjs'), marker = join(directory, 'ran')
  writeFileSync(hanging, "require('node:test')('leak', () => {}); setInterval(() => {}, 1000)")
  writeFileSync(passing, `require('node:test')('next', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'))`)
  assert.equal(runTestFiles([hanging, passing], { timeout: 500, stdio: 'pipe' }), 1)
  assert.equal(readFileSync(marker, 'utf8'), 'yes')
})

test('ordinary failures remain failures and successful files return zero', t => {
  const directory = fixture(t), file = join(directory, 'result.test.cjs')
  writeFileSync(file, "require('node:test')('fail', () => { throw new Error('expected failure') })")
  assert.equal(runTestFiles([file], { stdio: 'pipe' }), 1)
  writeFileSync(file, "require('node:test')('pass', () => {})")
  assert.equal(runTestFiles([file], { stdio: 'pipe' }), 0)
})
