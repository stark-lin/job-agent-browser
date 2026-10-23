const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { Client } = require('@modelcontextprotocol/client')
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
const { createBackend } = require('../.cache/tests/src/platform/database/backend.js')
const { extractPdf } = require('../.cache/tests/src/platform/profile-import/pdf.js')
const { resumeAllowlist } = require('../.cache/tests/src/platform/tools/resume.js')

async function until(check, message) {
  const deadline = Date.now() + 10000
  while (!check()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)) }
}
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'resume-mcp-smoke-')), entry = resolve(__dirname, '../out/main/job-agent-mcp.js')
  const backend = createBackend(join(directory, 'database.sqlite'))
  const dispatch = (group, method, input) => { const result = backend.dispatch(group, method, input); assert(result.ok, result.error); return result.value }
  const job = dispatch('jobs', 'saveJob', { details: { title: 'TypeScript Engineer', companyNameRaw: 'Offline Fixture', description: 'Build reliable TypeScript services and test them.' } })
  const profile = dispatch('profiles', 'createProfile', { name: 'MCP Resume Fixture', email: 'fixture@example.com' })
  const item = dispatch('profiles', 'addItem', { profileId: profile.id, details: { type: 'EXPERIENCE', title: 'Engineer', organization: 'Fixture Team' } })
  const fact = dispatch('profiles', 'addFact', { profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: 'Built TypeScript services with automated tests.' } })
  const baseline = backend.resumes.createRun({ jobId: job.id, profileId: profile.id }); backend.generation.start({ id: baseline.id })
  const client = new Client({ name: 'codex-smoke', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: resolve(__dirname, '..'), env: { JOB_BROWSER_USER_DATA: directory }, stderr: 'pipe', maxBufferSize: 2097152 })
  let diagnostics = ''
  transport.stderr?.on('data', chunk => { if (diagnostics.length < 4000) diagnostics += chunk })
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }, { timeout: 100000 }); assert(!result.isError, JSON.stringify(result)); return result.structuredContent }
  try {
    await client.connect(transport)
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...resumeAllowlist].sort())
    assert.equal(backend.resumes.getRun({ id: baseline.id }).run.status, 'RUNNING', 'MCP startup must preserve another process task')
    assert.equal((await call('job.list', {})).items[0].id, job.id)
    assert.equal((await call('profile.list', {})).items[0].id, profile.id)
    const { runId } = await call('resume.start', { jobId: job.id, profileId: profile.id, requestId: randomUUID() })
    dispatch('profiles', 'editContact', { id: profile.id, details: { name: 'LIVE PROFILE CHANGED' } })
    const context = await call('resume.get_context', { runId }), facts = await call('resume.list_facts', { runId })
    assert.equal(context.profile.name, profile.name); assert.equal(facts.total, 1)
    await call('resume.submit_scores', { runId, language: 'en', scores: [{ factId: fact.id, score: 95, reason: 'Direct evidence for TypeScript service delivery and tests.' }] })
    await call('resume.submit_gate', { runId, gate: { passed: true, reason: 'Saved evidence supports the role.', missingRequirements: [] } })
    await call('resume.submit_selection', { runId, selection: { factIds: [fact.id], itemIds: [item.id], wordBudget: 500 } })
    const writing = { summary: { id: randomUUID(), text: fact.content, factIds: [fact.id] }, experience: [{ profileItemId: item.id, bullets: [{ id: randomUUID(), text: fact.content, factIds: [fact.id] }] }], projects: [], education: [], skills: [] }
    await call('resume.submit_draft', { runId, writing }); await call('resume.submit_polished', { runId, writing })
    const { artifact } = await call('resume.publish', { runId })
    const built = await call('artifact.build', { artifactId: artifact.id })
    assert.equal(built.output.status, 'READY', `Worker output failed: ${JSON.stringify(built)} ${diagnostics}`)
    for (const file of built.files) assert(existsSync(file.path))
    const html = readFileSync(built.files.find(file => file.format === 'HTML').path, 'utf8')
    const pdf = readFileSync(built.files.find(file => file.format === 'PDF').path)
    assert(html.includes(profile.name)); assert(html.includes(fact.content)); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    const pages = await extractPdf(new Uint8Array(pdf), new AbortController().signal, () => {}, resolve(__dirname, '../out/main/pdf-worker.mjs'))
    assert.equal(pages.length, built.output.pages); assert(pages.map(page => page.text).join(' ').includes('TypeScript services'))
    const view = await call('artifact.get', { id: artifact.id })
    assert.equal(view.provenance.length, 2)
    assert.equal(backend.resumes.getRun({ id: runId }).run.config.runtimeKind, 'external')
    assert.equal(backend.resumes.getRun({ id: runId }).run.config.providerId, '')
    // Audit has no model call, and the still-open parent backend remains independently writable.
    assert.equal(backend.dispatch('audit', 'list', { targetType: 'ai_request' }).value.total, 0)
    backend.generation.recordScores({ id: baseline.id, language: 'en', scores: [{ factId: fact.id, score: 90, reason: '' }] })
    const cancel = new AbortController(), cancelled = client.callTool({ name: 'artifact.build', arguments: { artifactId: artifact.id } }, { signal: cancel.signal })
    await until(() => backend.resumes.getArtifact({ id: artifact.id }).artifact.output.status === 'RUNNING', 'Second build did not start')
    cancel.abort(); await assert.rejects(cancelled)
    await until(() => backend.resumes.getArtifact({ id: artifact.id }).artifact.output.status === 'CANCELLED', 'Cancelled worker did not settle')
    assert.equal((await call('artifact.build', { artifactId: artifact.id })).output.status, 'READY')
    const unfinished = await call('resume.start', { jobId: job.id, profileId: profile.id, requestId: randomUUID() })
    const pid = transport.pid
    await client.close()
    await until(() => { try { process.kill(pid, 0); return false } catch { return true } }, 'MCP process remained alive after EOF')
    backend.recover()
    assert.equal(backend.resumes.getRun({ id: unfinished.runId }).run.status, 'INTERRUPTED')
    assert.equal(backend.resumes.getRun({ id: baseline.id }).run.status, 'RUNNING')
    const crashed = new Client({ name: 'crash-smoke', version: '1' })
    const crashTransport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { JOB_BROWSER_USER_DATA: directory }, stderr: 'ignore' })
    try {
      await crashed.connect(crashTransport)
      const result = await crashed.callTool({ name: 'resume.start', arguments: { jobId: job.id, profileId: profile.id, requestId: randomUUID() } })
      assert(!result.isError)
      process.kill(crashTransport.pid, 'SIGKILL')
      await until(() => { try { process.kill(crashTransport.pid, 0); return false } catch { return true } }, 'Crashed MCP process was not reaped')
      backend.recover()
      assert.equal(backend.resumes.getRun({ id: result.structuredContent.runId }).run.status, 'INTERRUPTED')
      assert.equal(backend.resumes.getRun({ id: baseline.id }).run.status, 'RUNNING')
    } finally { await crashed.close() }
    const env = { ...process.env }; delete env.JOB_BROWSER_USER_DATA
    const missing = spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 10000 })
    assert.equal(missing.status, 1); assert.equal(missing.stdout, ''); assert(missing.stderr.includes('MCP_DATA_REQUIRED'))
    console.log('Outbound MCP smoke passed: built Node stdio entry, shared SQLite across processes, immutable snapshot, full external workflow, real Electron HTML/PDF worker, PDF text/page validation, cancellation/rebuild, EOF/crash recovery and zero application model calls.')
  } finally { await client.close().catch(() => {}); backend.close(); rmSync(directory, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
