const { app } = require('electron')
const assert = require('node:assert/strict')
const { resolve, join } = require('node:path')
const { readFileSync } = require('node:fs')
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const receipt = JSON.parse(readFileSync(join(process.env.JOB_BROWSER_SMOKE_DATA, 'resume-receipt.json'), 'utf8'))
const timer = setTimeout(() => { console.error('Resume restart timed out'); app.exit(1) }, 25000)
app.once('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  const evaluate = code => window.webContents.executeJavaScript(`(async () => (${code}))()`)
  try {
    const interrupted = await evaluate(`window.data.resumes.getRun({id:${JSON.stringify(receipt.pendingId)}})`)
    assert.equal(interrupted.value.run.status, 'INTERRUPTED')
    let task = (await evaluate(`window.resume.getTask({runId:${JSON.stringify(receipt.runId)}})`)).value
    assert.equal(task.run.status, 'SUCCEEDED'); assert.equal(task.artifact.output.error, 'OUTPUT_INTERRUPTED')
    const retry = await evaluate(`window.resume.retryOutput({artifactId:${JSON.stringify(receipt.artifactId)}})`)
    assert(retry.ok, retry.error)
    const until = Date.now() + 15000
    while (Date.now() < until) {
      task = (await evaluate(`window.resume.getTask({runId:${JSON.stringify(receipt.runId)}})`)).value
      if (!task.active) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(task.artifact.output.status, 'READY'); assert.equal(task.artifact.outputFiles.length, 2)
    // The original model server is stopped; successful reconstruction proves no model call.
    assert((await evaluate(`window.resume.getPreview({artifactId:${JSON.stringify(receipt.artifactId)}})`)).ok)
    console.log('Resume restart passed: pending run interrupted, published Artifact retained, unrecorded files reconciled by model-free output rebuild.')
    clearTimeout(timer); app.exit(0)
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1) }
}))
require(resolve(__dirname, '../out/main/index.js'))
