import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createMCPClient } from '../src/platform/mcp/client'
import { MCPAgentTools } from '../src/platform/mcp/first-party-client'
import { jobAgentAllowlist } from '../src/platform/tools'
import { runResumeAgent } from '../src/platform/agent/resume'
import { resumeReadTools, resumeStages, resumeSubmitTools } from '../src/domain/resume/workflow'
import type { GenerationRun, Artifact } from '../src/domain/resume/resume.types'

// Both sides use separate real stdio Servers sharing the same database.
test('internal and external MCP sessions expose identical contracts and produce equivalent state, provenance and HTML', async t => {
  const f = await firstPartyFixture(t), signal = new AbortController().signal
  const internal = await f.mcp.session('resume', signal)
  const client = createMCPClient({ id: 'codex', enabled: true, transport: 'stdio', command: process.execPath,
    args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { closed() {}, changed() {} },
    { processEnv: { JOB_BROWSER_USER_DATA: f.directory, JOB_BROWSER_MCP_CALLER: 'codex', ELECTRON_RUN_AS_NODE: '1' } })
  t.after(() => client.close())
  await client.connect()
  const external = new MCPAgentTools(client, await client.listTools(), signal)
  assert.deepEqual(await internal.list(), await external.list())
  assert.deepEqual((await internal.list()).map(tool => tool.name).sort(), [...jobAgentAllowlist].sort())
  const writing = { summary: { id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] }, experience: [], projects: [], education: [], skills: [] }
  const outputs = [{ language: 'en', scores: [{ factId: f.fact.id, score: 95, reason: 'Relevant' }] },
    { passed: true, reason: 'Supported', missingRequirements: [] }, { factIds: [f.fact.id], itemIds: [f.item.id], wordBudget: 500 }, writing, writing]
  const start = { jobId: f.job.id, profileId: f.profile.id }
  const { runId } = await internal.call('resume.start', { ...start, requestId: randomUUID() }, signal) as { runId: string }
  const read = internal.view(resumeReadTools, { runId })
  const artifact = await runResumeAgent({ id: runId, config: { targetWordCount: 500 } }, { tools: internal, signal, stage() {}, runner: async stage => {
    await read.call('resume.get_context', { runId }, signal); await read.call('resume.list_facts', { runId }, signal)
    return JSON.stringify(outputs[resumeStages.indexOf(stage as typeof resumeStages[number])])
  } })
  assert(artifact); await internal.call('artifact.build', { artifactId: artifact.id }, signal)
  const other = await external.call('resume.start', { ...start, requestId: randomUUID() }, signal) as { runId: string }
  const fields = [outputs[0], { gate: outputs[1] }, { selection: outputs[2] }, { writing }, { writing }]
  for (const [index, name] of resumeSubmitTools.entries()) await external.call(name, { runId: other.runId, ...fields[index] }, signal)
  const { artifact: otherArtifact } = await external.call('resume.publish', { runId: other.runId }, signal) as { artifact: Artifact }
  await external.call('artifact.build', { artifactId: otherArtifact.id }, signal)
  const normalized = (run: GenerationRun) => ({ status: run.status, stage: run.stage, language: run.language, inputSnapshot: run.inputSnapshot,
    scores: run.scores, gate: run.gate, selection: run.selection, draft: run.draft, polished: run.polished, error: run.error })
  assert.deepEqual(normalized(f.backend.resumes.getRun({ id: other.runId }).run), normalized(f.backend.resumes.getRun({ id: runId }).run))
  const a = f.backend.resumes.getArtifact({ id: artifact.id }), b = f.backend.resumes.getArtifact({ id: otherArtifact.id })
  assert.deepEqual(a.artifact.content, b.artifact.content); assert.deepEqual(a.provenance, b.provenance)
  const html = (item: Artifact) => readFileSync(join(f.outputDirectory, item.outputFiles.find(file => file.format === 'HTML')!.relativePath), 'utf8')
  assert.equal(html(a.artifact), html(b.artifact))
  const audit = f.backend.toolAudit.list()
  assert(audit.some(row => row.agent_id === 'internal.resume')); assert(audit.some(row => row.agent_id === 'codex'))
  await assert.rejects(read.call('resume.get_context', { runId: other.runId }, signal), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(internal.call('resume.fail', { runId: other.runId, error: 'VALIDATION_FAILED' }, signal), { code: 'TOOL_FORBIDDEN' })
})

test('resume skill editions use public names and preserve the five submission stages in order', () => {
  for (const name of ['SKILL.md', 'SKILL.zh-CN.md']) {
    const text = readFileSync(join('skills/tailor-resume', name), 'utf8')
    const names = [...new Set(text.match(/\b(?:resume|artifact|job|profile)\.[a-z_]+\b/g))]
    assert(names.every(name => jobAgentAllowlist.includes(name as typeof jobAgentAllowlist[number])))
    const order = resumeSubmitTools.map(tool => text.indexOf(tool))
    assert(order.every((offset, index) => offset >= 0 && (index === 0 || offset > order[index - 1])))
  }
})
