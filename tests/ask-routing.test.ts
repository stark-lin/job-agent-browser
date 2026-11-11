import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { fixtureCapabilities } from './ask-fixture'
import { scriptedModel } from './disclosure-fixture'

for (const scenario of ['projects', 'fit', 'ambiguous', 'incomplete'] as const) test(`Ask ${scenario} uses authoritative MCP data and finishes without generation`, async t => {
  const f = await firstPartyFixture(t)
  if (scenario === 'ambiguous') f.backend.profiles.createProfile({ name: 'Another profile' })
  const names = scenario === 'ambiguous' ? ['profile.list'] : scenario === 'fit'
    ? ['profile.list', 'profile.get', 'profile.list_items', 'profile.list_facts', 'job.get']
    : ['profile.list', 'profile.list_items', 'profile.list_facts']
  const steps = names.map(name => ({ name, arguments: name === 'profile.list' ? {} : name === 'profile.get' ? { id: f.profile.id }
    : name === 'job.get' ? { id: f.job.id } : { profileId: f.profile.id } }))
  const replies = { projects: f.item.title + ' ' + f.fact.content, fit: 'The saved facts support this comparison: ' + f.fact.content,
    ambiguous: 'Which saved profile should I use?', incomplete: 'These are the confirmed records; additional project details are missing.' }
  const fixture = scriptedModel((request, round) => {
    const system = request.messages.find(m => m.role === 'system')?.content ?? ''
    assert(system.includes('Route personal projects, experience and skills to profile.list'))
    assert(system.includes('After two consecutive calls to the same source yield no new information'))
    assert(system.includes('ask which profile to use rather than choosing arbitrarily'))
    assert(system.includes('Job-fit analysis compares the saved Job against Profile items and Facts only'))
    assert(!request.tools.some(t => /^\[(resume\.|artifact\.build)/.test(t.function.description)))
    if (round === 1) return [{ name: 'scope.profile', arguments: {} }]
    if (round === 2) return scenario === 'fit' ? [{ name: 'scope.job', arguments: {} }] : [{ name: 'scope.profile', arguments: {} }]
    if (round <= steps.length + 2) return [steps[round - 3]]
    const results = request.messages.filter(m => m.role === 'tool').map(m => m.content).join('\n')
    if (scenario !== 'ambiguous') assert(results.includes(f.fact.content))
    else assert(results.includes('Another profile'))
    return replies[scenario]
  })
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => fixture.model, capabilities: async () => fixtureCapabilities })
  t.after(() => tasks.dispose())
  const messages = { projects: 'What projects, experience and skills are saved?', fit: 'Am I suited for this saved job?', ambiguous: 'Tell me about my projects', incomplete: 'List the confirmed records and any missing project details' }
  const ids = tasks.start(1, { requestId: randomUUID(), message: messages[scenario], choice: { providerId: 'fixture', modelId: 'test' } }, () => {})
  for (let n = 0; n < 500 && tasks.getRun(1, { runId: ids.runId }).run.state === 'running'; n++) await new Promise(r => setTimeout(r, 10))
  const snapshot = f.backend.chats.snapshot(ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(snapshot.run.writeStarted, false)
  assert(snapshot.items.some(i => i.content.type === 'assistant_message' && i.content.text === replies[scenario]))
  const business = snapshot.items.flatMap(i => i.content.type === 'tool_call' && !i.content.toolName.startsWith('scope.') ? [i.content.toolName] : [])
  assert.deepEqual(business, names)
  assert.equal(f.backend.resumes.listRuns({}).total, 0); assert.equal(f.outputs(), 0)
})
