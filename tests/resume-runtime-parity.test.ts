import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { value } from './helpers'
import { firstPartyFixture } from './first-party-fixture'
import { createMCPClient } from '../src/platform/mcp/client'
import { MCPAgentTools } from '../src/platform/mcp/first-party-client'
import { jobAgentAllowlist } from '../src/platform/tools'
import { resumeAgentTools, resumeAgentLifecycle } from '../src/shared/agent/resume-policy'
import { createAgentRecorder } from '../src/platform/electron/agent-recorder'
import type { Artifact } from '../src/domain/resume/resume.types'

// Both sides use separate real stdio Servers sharing the same database.
test('internal and external MCP sessions use distinct capabilities and produce equivalent state, provenance and HTML', async t => {
  const f = await firstPartyFixture(t), signal = new AbortController().signal
  value(await f.api.profiles.editContact({ id: f.profile.id, details: { name: f.profile.name, introduction: f.fact.content } }))
  const internal = await f.mcp.session('resume', signal)
  const client = createMCPClient({ id: 'codex', enabled: true, transport: 'stdio', command: process.execPath,
    args: [join(f.directory, 'job-agent-mcp.js')], tools: [] }, { closed() {}, changed() {} },
    { processEnv: { JOB_BROWSER_USER_DATA: f.directory, JOB_BROWSER_MCP_CALLER: 'codex', ELECTRON_RUN_AS_NODE: '1' } })
  f.cleanup(() => client.close())
  await client.connect()
  const external = new MCPAgentTools(client, await client.listTools(), signal)
  assert.deepEqual((await external.list()).map(tool => tool.name).sort(), [...jobAgentAllowlist].sort())
  assert.deepEqual((await internal.list()).map(tool => tool.name).sort(), [...resumeAgentLifecycle].sort())
  const start = { jobId: f.job.id, profileId: f.profile.id }, requestId = randomUUID()
  const { runId } = await internal.call('resume.start', { ...start, requestId }, signal) as { runId: string }
  await assert.rejects(internal.call('resume.publish', { runId }, signal), { code: 'TOOL_CONFLICT' })
  const { agentRunId } = await internal.call('resume.attach_agent', { runId, requestId, ownerRuntimeId: f.backend.lease.id }, signal) as { agentRunId: string }
  const agent = await f.mcp.openAgentRun({ agent: 'resume', agentRunId, sessionId: 'default', generationRunId: runId, signal })
  assert.deepEqual((await agent.tools.list()).map(tool => tool.name).sort(), [...resumeAgentTools].sort())
  const other = await external.call('resume.start', { ...start, requestId: randomUUID() }, signal) as { runId: string }
  assert(!(await external.list()).some(tool => tool.name === 'resume.attach_agent'))
  await assert.rejects(agent.tools.call('resume.get_context', { runId: other.runId }, signal), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(agent.tools.call('resume.publish', { runId }, signal), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(agent.tools.call('memory.write', { path: 'CORE.md', content: 'Forbidden', expectedRevision: null }, signal), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(agent.tools.call('knowledge.write', {}, signal), { code: 'TOOL_FORBIDDEN' })
  await assert.rejects(agent.tools.call('memory.read', { path: 'CORE.md' }, signal), { code: 'TOOL_NOT_FOUND' })
  const rewrite = async (tools: MCPAgentTools, id: string) => {
    const page = await tools.call('resume.list_bullets', { runId: id }, signal) as { items: { bulletId: string }[] }
    const input = { runId: id, bulletId: page.items[0].bulletId, text: f.fact.content + '.', requestId: randomUUID() }
    await tools.call('resume.rewrite_bullet', input, signal)
    return input
  }
  const input = await rewrite(agent.tools, runId)
  await agent.close()
  await assert.rejects(agent.tools.call('resume.rewrite_bullet', input, signal))
  createAgentRecorder(f.backend.chats, f.backend.chats.agentSnapshot(agentRunId), () => {}, () => {}).finish('completed', null)
  const { artifact } = await internal.call('resume.publish', { runId }, signal) as { artifact: Artifact }
  await internal.call('artifact.build', { artifactId: artifact.id }, signal)
  await rewrite(external, other.runId)
  const { artifact: otherArtifact } = await external.call('resume.publish', { runId: other.runId }, signal) as { artifact: Artifact }
  await external.call('artifact.build', { artifactId: otherArtifact.id }, signal)
  const a = f.backend.resumes.getArtifact({ id: artifact.id }), b = f.backend.resumes.getArtifact({ id: otherArtifact.id })
  assert.equal(a.artifact.content.experience[0].bullets[0].text, b.artifact.content.experience[0].bullets[0].text)
  assert.deepEqual(a.provenance.map(block => block.factIds), b.provenance.map(block => block.factIds))
  const ask = await f.askRun(signal, 'artifact-reader')
  const saved = await ask.call('artifact.get', { id: artifact.id }, signal) as { artifact: Artifact }
  assert.deepEqual(saved.artifact, a.artifact)
  await assert.rejects(ask.call('artifact.build', { artifactId: artifact.id }, signal), { code: 'TOOL_FORBIDDEN' })
  const html = (item: Artifact) => readFileSync(join(f.outputDirectory, item.outputFiles.find(file => file.format === 'HTML')!.relativePath), 'utf8')
  assert.equal(html(a.artifact), html(b.artifact))

  await assert.rejects(internal.call('resume.fail', { runId: other.runId, error: 'VALIDATION_FAILED' }, signal), { code: 'TOOL_FORBIDDEN' })
  const { runId: concurrentRunId } = await external.call('resume.start', { ...start, requestId: randomUUID() }, signal) as { runId: string }
  const concurrent = { runId: concurrentRunId }
  const page = await external.call('resume.list_bullets', concurrent, signal) as { items: { bulletId: string }[] }
  const attempts = ['First concurrent wording', 'Second concurrent wording'].map(text => ({
    ...concurrent, bulletId: page.items[0].bulletId, text, requestId: randomUUID()
  }))
  const outcomes = await Promise.allSettled(attempts.map(args => external.call('resume.rewrite_bullet', args, signal)))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  const conflict = outcomes.find(result => result.status === 'rejected')
  assert.equal(conflict?.reason.code, 'TOOL_CONFLICT')
  assert.equal(f.backend.rewrittenBulletIds(concurrent.runId).length, 1)
  const winner = outcomes.findIndex(result => result.status === 'fulfilled')
  assert.equal(f.backend.generationRun(concurrent.runId).assembled!.experience[0].bullets[0].text, attempts[winner].text)
  const replay = await external.call('resume.rewrite_bullet', attempts[winner], signal)
  assert.deepEqual(replay, (outcomes[winner] as PromiseFulfilledResult<unknown>).value)
  await external.call('resume.cancel', concurrent, signal)
})

test('dedicated Resume retains same-session failure and cancellation over real MCP', async t => {
  const f = await firstPartyFixture(t), signal = new AbortController().signal, tools = await f.mcp.session('resume', signal)
  for (const operation of ['resume.fail', 'resume.cancel']) {
    const { runId } = await tools.call('resume.start', { requestId: randomUUID(), jobId: f.job.id, profileId: f.profile.id }, signal) as { runId: string }
    const result = await tools.call(operation, { runId, ...(operation === 'resume.fail' ? { error: 'VALIDATION_FAILED' } : {}) }, signal) as { state: string }
    assert.equal(result.state, operation === 'resume.fail' ? 'FAILED' : 'CANCELLED')
    assert.equal(f.backend.resumes.getRun({ id: runId }).run.state, result.state)
  }
})

test('resume skill editions use public names and preserve the V3 contract', () => {
  for (const name of ['SKILL.md', 'SKILL.zh-CN.md']) {
    const text = readFileSync(join('skills/tailor-resume', name), 'utf8')
    const names = [...new Set(text.match(/\b(?:resume|artifact|job|profile)\.[a-z_]+\b/g))]
    // profile.introduction is a context property, not a callable tool.
    assert(names.filter(name => name !== 'profile.introduction').every(name => jobAgentAllowlist.includes(name as typeof jobAgentAllowlist[number])))
    const order = ['resume.start', 'resume.get_context', 'resume.list_bullets', 'resume.rewrite_bullet', 'resume.publish', 'artifact.build'].map(tool => text.indexOf(tool))
    assert(order.every((offset, index) => offset >= 0 && (index === 0 || offset > order[index - 1])))
  }
})
