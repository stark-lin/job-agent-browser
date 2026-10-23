import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createBackend } from '../src/platform/database/backend'
import { createToolRuntime } from '../src/platform/mcp/runtime'
import { readMCPConfiguration } from '../src/platform/storage/mcp-config'
import { writeJSON } from '../src/platform/storage/files'
import { caller, serverConfig, until } from './tool-fixtures'

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'job-mcp-runtime-')), databasePath = join(directory, 'data.sqlite')
  const configPath = join(directory, 'mcp.json'), config = serverConfig(['echo', 'slow'])
  writeJSON(configPath, { version: 1, servers: [config] })
  let backend = createBackend(databasePath)
  const compose = () => createToolRuntime({ configuration: () => readMCPConfiguration(configPath), capabilities: backend.capabilities,
    native: backend.toolCapabilities.read, recoverAudit: backend.toolAudit.recoverInterrupted })
  let runtime = compose()
  try {
    await runtime.start()
    assert.equal(runtime.status().servers[0].state, 'ready')
    const created = backend.dispatch('jobs', 'saveJob', { details: { title: 'PRIVATE_SMOKE_JOB', companyNameRaw: 'PRIVATE_SMOKE_COMPANY' } })
    assert(created.ok)
    const job = created.value as { id: string }
    const scope = runtime.scope({ allow: ['job.get', 'fixture.*'] }, caller())
    assert.equal('execute' in scope.get('job.get')!, false)
    await scope.execute('job.get', { id: job.id })
    const result = await scope.execute('fixture.echo', { text: 'PRIVATE_SMOKE_PAYLOAD' })
    const pid = (result.structuredContent as { pid: number }).pid
    assert.equal((result.structuredContent as { text: string }).text, 'PRIVATE_SMOKE_PAYLOAD')
    await assert.rejects(scope.execute('fixture.delete_everything', { text: '' }), { code: 'TOOL_FORBIDDEN' })
    const cancellation = new AbortController(), cancelScope = runtime.scope({ allow: ['fixture.slow'] }, { agentId: 'smoke-agent', signal: cancellation.signal })
    const pending = cancelScope.execute('fixture.slow', { text: 'PRIVATE_SMOKE_PAYLOAD' })
    setTimeout(() => cancellation.abort(), 15)
    await assert.rejects(pending, { code: 'TOOL_CANCELLED' })
    await backend.toolCapabilities.write.setArchived.execute({ id: job.id, archived: true }, caller())
    await runtime.disconnect('fixture')
    assert.equal(scope.get('fixture.echo'), null)
    await until(() => { try { process.kill(pid, 0); return false } catch { return true } }, 'Child process did not exit')
    await runtime.reconnect('fixture')
    assert.equal(scope.get('fixture.echo'), null)
    assert.notEqual(runtime.scope({ allow: ['fixture.echo'] }, caller()).get('fixture.echo'), null)
    const records = backend.toolAudit.list(), serialized = JSON.stringify(records)
    assert.equal(records.filter(row => row.phase === 'START').length, 4)
    assert.equal(records.filter(row => row.phase === 'END').length, 4)
    for (const secret of ['PRIVATE_SMOKE_PAYLOAD', 'PRIVATE_SMOKE_JOB', 'PRIVATE_SMOKE_COMPANY']) assert.equal(serialized.includes(secret), false)
    const orphanId = randomUUID()
    backend.toolAudit.sink.start({ invocationId: orphanId, agentId: 'smoke-agent', tool: backend.toolCapabilities.read[0].descriptor })
    await runtime.dispose(); backend.close()
    backend = createBackend(databasePath); runtime = compose()
    await runtime.start()
    assert.equal(backend.toolAudit.list().find(row => row.invocation_id === orphanId && row.phase === 'END')?.status, 'INTERRUPTED')
    const audits = backend.dispatch('audit', 'list', { targetId: job.id })
    assert(audits.ok)
    assert.equal((audits.value as { total: number }).total, 2)
    console.log('MCP runtime smoke passed: bundled Electron runtime, real stdio, scoped native/external calls, audited read/write, cancellation, revocation, restart recovery and process cleanup.')
  } finally { await runtime.dispose(); backend.close(); rmSync(directory, { recursive: true, force: true }) }
}
void main().catch(() => { console.error('MCP runtime smoke failed.'); process.exitCode = 1 })
