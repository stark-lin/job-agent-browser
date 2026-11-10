const { spawnSync } = require('node:child_process')

const testTimeoutMs = 60000
/** Parent-owned deadline also catches blocked event loops and leaked handles after tests finish. */
function runTestProcess(command, args, options = {}) {
  const timeout = options.timeout ?? testTimeoutMs
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > testTimeoutMs) throw new Error('Test timeout must be between 1 and 60000 ms')
  const result = spawnSync(command, args, { stdio: 'inherit', ...options, timeout, killSignal: 'SIGKILL' })
  if (result.error?.code === 'ETIMEDOUT') console.error(`Test timed out after ${timeout} ms: ${args.join(' ')}`)
  else if (result.error) console.error(result.error.message)
  return result
}

function runTestFiles(files, options = {}) {
  let failed = false
  for (const file of files) {
    // Avoid an intermediate test worker so the parent can kill the actual test process.
    const result = runTestProcess(options.executable ?? process.execPath,
      ['--test', '--test-isolation=none', `--test-timeout=${testTimeoutMs}`, file],
      { cwd: options.cwd, env: options.env, timeout: options.timeout, stdio: options.stdio ?? 'inherit' })
    if (result.error || result.status !== 0) failed = true
  }
  return failed ? 1 : 0
}

module.exports = { runTestProcess, runTestFiles, testTimeoutMs }
if (require.main === module) {
  if (process.argv.length < 3) throw new Error('At least one test file is required')
  process.exitCode = runTestFiles(process.argv.slice(2))
}
