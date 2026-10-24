import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { firstPartyFixture } from './first-party-fixture'
import { createJobImporter } from '../src/platform/job-import/service'
import type { JobImportEvent } from '../src/platform/electron/job-import-contract'

const { pdfFixture } = require(resolve(process.cwd(), 'scripts/profile-fixtures.cjs')) as { pdfFixture(options?: { text?: string; scanned?: boolean }): Buffer }
const choice = { providerId: 'fixture', modelId: 'fixture' }

test('text and real PDF capture understand source without MCP, then save edited drafts once through MCP with no invented URL', async t => {
  const f = await firstPartyFixture(t), prompts: string[] = []
  let connections = 0
  const mcp = { ...f.mcp, session: (...args: Parameters<typeof f.mcp.session>) => { connections++; return f.mcp.session(...args) } }
  const importer = createJobImporter({ mcp, model: () => ({ complete: async input => {
    prompts.push(input.messages[0].content)
    return { content: '{"title":"Engineer","companyNameRaw":"Company"}', toolCalls: [] }
  } }), pdfWorker: resolve(process.cwd(), 'src/platform/import/pdf-worker.mjs'), reader: { read: () => assert.fail('Text and PDF do not fetch URLs') } })
  t.after(() => importer.dispose())
  for (const source of [{ text: 'Engineer at Company' }, { fileId: importer.select(1, pdfFixture({ text: 'Engineer at Company' })).fileId }]) {
    const ready = await new Promise<JobImportEvent & { type: 'ready' }>((resolve, reject) => importer.start(1, { ...source, choice }, event => {
      if (event.type === 'ready') resolve(event)
      if (event.type === 'failed') reject(new Error(event.error))
    }))
    assert.equal(connections, prompts.length - 1)
    assert.equal(ready.draft.source, null)
    assert.equal(importer.getTask(1, { taskId: ready.taskId }).state, 'ready')
    const input = { taskId: ready.taskId, details: { ...ready.draft.details, title: 'Reviewed engineer' }, source: null }
    const saved = await importer.save(1, input)
    assert.equal(saved.title, 'Reviewed engineer')
    assert.deepEqual(await importer.save(1, input), saved)
    assert.equal(f.backend.dispatch('jobs', 'listSources', { jobId: saved.id }).ok, true)
  }
  assert(prompts.every(prompt => prompt.includes('Engineer at Company')))
  assert.equal(f.backend.jobs.listJobs({}).total, 3)
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM job_sources').get()?.n, 1)
  assert.equal(f.database.connection.prepare('SELECT count(*) n FROM operation_receipts').get()?.n, 2)
})

test('PDF selection is owner-bound and scans fail before model reasoning or persistence', async t => {
  const f = await firstPartyFixture(t)
  let models = 0
  const importer = createJobImporter({ mcp: f.mcp, model: () => { models++; return { complete: async () => ({ content: '{}', toolCalls: [] }) } },
    pdfWorker: resolve(process.cwd(), 'src/platform/import/pdf-worker.mjs'), reader: { read: () => assert.fail('no URL') } })
  t.after(() => importer.dispose())
  const selected = importer.select(1, pdfFixture({ scanned: true }))
  assert.throws(() => importer.start(2, { fileId: selected.fileId, choice }, () => {}), { code: 'FORBIDDEN' })
  const failed = await new Promise<JobImportEvent & { type: 'failed' }>(resolve => importer.start(1, { fileId: selected.fileId, choice }, event => {
    if (event.type === 'failed') resolve(event)
  }))
  assert.equal(failed.error, 'PDF_NO_TEXT'); assert.equal(models, 0)
  assert.equal(f.backend.jobs.listJobs({}).total, 1)
  assert.throws(() => importer.start(1, { text: 'JD', url: 'https://example.com', choice }, () => {}), { code: 'INVALID_INPUT' })
})
