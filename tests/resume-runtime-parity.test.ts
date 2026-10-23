import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { seed } from './helpers'
import { createBackend } from '../src/platform/database/backend'
import { createResumeTooling, resumeAllowlist } from '../src/platform/tools/resume'
import { createResumeOutput, type ResumeRenderer } from '../src/platform/resume-output/service'
import { createMCPServer } from '../src/platform/mcp-server/server'
import { runResumeAgent } from '../src/domain/resume/resume.agent'
import { compileHTML } from '../src/platform/resume-output/compiler'
import { resumeReadTools, resumeStages, resumeSubmitTools } from '../src/domain/resume/workflow'
import type { GenerationRun, Artifact } from '../src/domain/resume/resume.types'

test('internal controller and MCP calls produce identical business state, provenance, HTML and output with fixed stage results', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'resume-parity-')), database = join(directory, 'database.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const f = await seed(t, database), external = createBackend(database, undefined, 'external')
  t.after(() => external.close())
  const render: ResumeRenderer = async document => ({ html: compileHTML(document, { id: 'default-v1', fontVersion: 'noto-sc-v1', fontBase64: 'AAAA' }), pdf: Buffer.from('deterministic fixture PDF'), pages: 1 })
  const aOutput = createResumeOutput(f.backend, join(directory, 'artifacts'), '', render), bOutput = createResumeOutput(external, join(directory, 'artifacts'), '', render)
  const a = createResumeTooling(f.backend, (id, signal) => aOutput.build(id, signal)), b = createResumeTooling(external, (id, signal) => bOutput.build(id, signal))
  t.after(() => { a.dispose(); b.dispose() })
  const signal = new AbortController().signal, writer = a.registry.scope({ allow: resumeAllowlist, maxRisk: 'WRITE' }, { agentId: 'resume-controller', signal })
  const writing = { summary: { id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] }, experience: [], projects: [], education: [], skills: [] }
  const outputs = [ { language: 'en', scores: [{ factId: f.fact.id, score: 95, reason: 'Relevant' }] },
    { passed: true, reason: 'Supported', missingRequirements: [] }, { factIds: [f.fact.id], itemIds: [f.item.id], wordBudget: 500 }, writing, writing ]
  const id = (await writer.execute('resume.start', { jobId: f.job.id, profileId: f.profile.id, requestId: randomUUID() })).structuredContent as { runId: string }
  const read = a.registry.scope({ allow: resumeReadTools }, { agentId: 'resume', runId: id.runId, signal })
  const artifact = await runResumeAgent(f.backend.resumes.getRun({ id: id.runId }).run, { tools: writer, signal, stage() {}, runner: async stage => {
    await read.execute('resume.get_context', { runId: id.runId }); await read.execute('resume.list_facts', { runId: id.runId })
    return JSON.stringify(outputs[resumeStages.indexOf(stage as typeof resumeStages[number])])
  } })
  assert(artifact); await writer.execute('artifact.build', { artifactId: artifact.id })
  const runtime = createMCPServer(b.registry, { allow: resumeAllowlist, maxRisk: 'WRITE' }, signal), client = new Client({ name: 'parity', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  t.after(async () => { read.dispose(); writer.dispose(); await client.close(); await runtime.dispose() })
  await runtime.server.connect(right); await client.connect(left)
  async function call(name: string, args: Record<string, unknown>) { const result = await client.callTool({ name, arguments: args }); assert(!result.isError, JSON.stringify(result)); return result.structuredContent as Record<string, unknown> }
  const start = await call('resume.start', { jobId: f.job.id, profileId: f.profile.id, requestId: randomUUID() }), runId = String(start.runId)
  await call('resume.get_context', { runId }); await call('resume.list_facts', { runId })
  const fields = [outputs[0], { gate: outputs[1] }, { selection: outputs[2] }, { writing }, { writing }]
  for (const [index, name] of resumeSubmitTools.entries()) await call(name, { runId, ...fields[index] })
  const published = await call('resume.publish', { runId }), otherArtifact = published.artifact as Artifact
  await call('artifact.build', { artifactId: otherArtifact.id })
  const normalized = (run: GenerationRun) => ({ status: run.status, stage: run.stage, language: run.language, inputSnapshot: run.inputSnapshot,
    scores: run.scores, gate: run.gate, selection: run.selection, draft: run.draft, polished: run.polished, error: run.error })
  assert.deepEqual(normalized(external.resumes.getRun({ id: runId }).run), normalized(f.backend.resumes.getRun({ id: id.runId }).run))
  const av = f.backend.resumes.getArtifact({ id: artifact.id }), bv = external.resumes.getArtifact({ id: otherArtifact.id })
  assert.deepEqual(bv.artifact.content, av.artifact.content); assert.deepEqual(bv.provenance, av.provenance); assert.deepEqual(bv.artifact.output, av.artifact.output)
  assert.equal((await bOutput.read(otherArtifact.id, 'HTML')).toString(), (await aOutput.read(artifact.id, 'HTML')).toString())
  assert.equal(external.resumes.getRun({ id: runId }).run.config.providerId, '')
  assert.equal(external.resumes.getRun({ id: runId }).run.config.runtimeKind, 'external')
  assert.equal(f.database.connection.prepare("SELECT count(*) n FROM audit_logs WHERE event_type='AGENT_MODEL_RESULT'").get()?.n, 0)
})

test('skill editions reference exactly the public tool contract and the five accepted stages in order', () => {
  for (const name of ['SKILL.md', 'SKILL.zh-CN.md']) {
    const text = readFileSync(join('skills/tailor-resume', name), 'utf8')
    const names = [...new Set(text.match(/\b(?:resume|artifact|job|profile)\.[a-z_]+\b/g))].sort()
    assert.deepEqual(names, [...resumeAllowlist].sort())
    const order = resumeSubmitTools.map(tool => text.indexOf(tool))
    assert(order.every((offset, index) => offset >= 0 && (index === 0 || offset > order[index - 1])))
  }
})
