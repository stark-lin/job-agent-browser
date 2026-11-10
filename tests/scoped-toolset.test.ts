import test from 'node:test'
import assert from 'node:assert/strict'
import { ScopedToolset } from '../src/platform/agent/tools/scoped-toolset'
import { ContextBudget } from '../src/platform/agent/context/budget'
import { scopeDirectory, scopeTools } from '../src/platform/mcp-server/scope-tools'
import { humanTool } from '../src/platform/mcp-server/tool-adapter'
import { askToolAllowlist } from '../src/shared/agent/ask-policy'
import { resumeAgentTools } from '../src/shared/agent/resume-policy'
import { jobAgentAllowlist } from '../src/shared/agent/business-policy'
import { descriptor, capabilities, signal, scriptedModel, expansion, runDisclosure } from './disclosure-fixture'

test('each Run expands whole authorized domains on the next loadout without eviction or activation', async () => {
  const catalog = ['job.list', 'job.get', 'profile.list', 'profile.get'].map(descriptor), calls: string[] = []
  const tools = { list: async () => [...catalog, ...scopeTools(catalog), humanTool], call: async (name: string) => { calls.push(name); return scopeDirectory(name, catalog) } }
  const registry = new ScopedToolset(tools, new ContextBudget(capabilities, 'test'))
  await registry.refresh(); assert.deepEqual(registry.loadout().map(tool => tool.name), ['scope.job', 'scope.profile', 'human.ask'])
  await assert.rejects(registry.call('profile.get', {}, signal()), /AGENT_PROTOCOL_ERROR/)
  const directory = await registry.call('scope.profile', {}, signal())
  assert.deepEqual(directory, scopeDirectory('scope.profile', catalog))
  await assert.rejects(registry.call('profile.get', {}, signal()), /AGENT_PROTOCOL_ERROR/)
  const expanded = registry.loadout(); assert(expanded.some(tool => tool.name === 'profile.get'))
  const version = registry.snapshot().version
  await registry.call('scope.profile', {}, signal()); registry.loadout(); assert.equal(registry.snapshot().version, version)
  await registry.call('scope.job', {}, signal()); registry.loadout()
  assert.equal(registry.loadout().filter(tool => !tool.name.startsWith('scope.') && tool.name !== 'human.ask').length, 4)
  await registry.call('profile.get', {}, signal())
  assert.deepEqual(calls, ['scope.profile', 'scope.profile', 'scope.job', 'profile.get'])
  const fresh = new ScopedToolset(tools, new ContextBudget(capabilities, 'test')); await fresh.refresh()
  assert(!fresh.loadout().some(tool => tool.name === 'profile.get'))
  for (const name of ['tool.search', 'tool.activate']) await assert.rejects(registry.call(name, {}, signal()), /AGENT_PROTOCOL_ERROR/)
})

test('expanded schemas exceeding the hard budget fail without silently dropping a domain', async () => {
  const catalog = [{ ...descriptor(), description: 'x'.repeat(200000) }]
  const registry = new ScopedToolset({ list: async () => [...catalog, ...scopeTools(catalog)], call: async () => ({}) }, new ContextBudget(capabilities, 'test'))
  await registry.refresh(); registry.loadout(); await registry.call('scope.job', {}, signal())
  assert.throws(() => registry.loadout(), /ASK_CONTEXT_OVERFLOW/)
})

test('Knowledge stays read-only and Memory write permissions belong only to authorized workflows', () => {
  for (const allow of [askToolAllowlist, resumeAgentTools, jobAgentAllowlist]) {
    assert.deepEqual(allow.filter(name => name.startsWith('knowledge.')).sort(), ['knowledge.list', 'knowledge.read', 'knowledge.retrieve', 'knowledge.search'])
    assert.equal(allow.filter(name => name.startsWith('memory.')).length, 5)
  }
})

test('Scope calls count toward the 256-tool ceiling independently of RunGuard progress', async () => {
  const fixture = scriptedModel((_body, round) => round <= 32 ? Array.from({ length: 8 }, () => expansion()) : [expansion()])
  await assert.rejects(runDisclosure(fixture.model, { list: async () => [descriptor()], call: async () => ({}) }, () => {}, 1048576), /AGENT_STEP_LIMIT/)
  assert.equal(fixture.requests.length, 33)
})
