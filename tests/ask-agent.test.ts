import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { firstPartyFixture } from './first-party-fixture'
import { createAskAgentTasks } from '../src/platform/electron/ask-agent-tasks'
import { jobAgentAllowlist } from '../src/platform/tools'
import type { AgentModelEvent, StreamingAgentModel, AgentToolCall } from '../src/shared/agent'
import type { AgentRunEvent } from '../src/domain/chat/chat.types'
const choice = { providerId: 'fixture', modelId: 'test' }
const start = (message: string, sessionId?: string) => ({ requestId: randomUUID(), message, sessionId, choice })
async function wait(tasks: ReturnType<typeof createAskAgentTasks>, runId: string) {
  for (let n = 0; n < 500; n++) { const s = tasks.getRun(1, { runId }); if (s.run.state !== 'running') return s; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Ask task timeout')
}
function answer(text: string): AgentModelEvent[] { return [{ type: 'content.delta', text }, { type: 'completed', response: { content: text, toolCalls: [] } }] }
function batch(call: AgentToolCall): AgentModelEvent[] { return [{ type: 'tool_call.ready', call }, { type: 'completed', response: { content: '', toolCalls: [call] } }] }
test('Ask AI streams read/write tools over real first-party MCP, stores only summaries, and keeps ordered events', async t => {
  const f = await firstPartyFixture(t), events: AgentRunEvent[] = []
  const batches = [batch({ id: 'jobs', name: 'job.list', arguments: {} }), batch({ id: 'profiles', name: 'profile.list', arguments: {} }),
    batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'PRIVATE_NOTE_BODY' } }),
    batch({ id: 'status', name: 'application.set_status', arguments: { jobId: f.job.id, status: 'APPLIED' } }), answer('Done')]
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    assert.deepEqual(input.tools, await (await f.mcp.session('ask-ai', new AbortController().signal)).list())
    assert.deepEqual(input.tools.map(tool => tool.name).sort(), [...jobAgentAllowlist].sort())
    yield* batches.shift()!
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const input = start('Add a note and mark applied'), ids = tasks.start(1, input, e => events.push(e))
  assert.deepEqual(tasks.start(1, input, () => {}), ids)
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.filter(i => i.content.type === 'tool_call').length, 4)
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_NOTE_BODY'), false)
  assert.equal(f.backend.jobs.getJob({ id: f.job.id }).applicationStatus, 'APPLIED')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).items.filter(e => e.type === 'NOTE').length, 1)
  assert(events.every((e, index) => e.eventSequence === index + 1))
  assert.equal(f.backend.chats.snapshot(ids.runId).run.eventSequence, events.at(-1)?.eventSequence)
  assert(f.backend.toolAudit.list().filter(a => a.agent_id === 'internal.ask-ai').length >= 8)
  assert.throws(() => tasks.getRun(2, { runId: ids.runId }), { code: 'FORBIDDEN' })
})
test('per-session exclusion, two simultaneous sessions, targeted cancellation, owner disposal and durable model snapshots', async t => {
  const f = await firstPartyFixture(t)
  let streaming = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    streaming++
    yield { type: 'reasoning.delta', text: 'Visible summary' }
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const a = tasks.start(1, start('A'), () => {}), b = tasks.start(1, start('B'), () => {})
  assert.throws(() => tasks.start(1, start('Again', a.sessionId), () => {}), { code: 'INVALID_STATE' })
  for (let n = 0; n < 500 && streaming < 2; n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(streaming, 2); assert.equal(tasks.listActive(1, {}).length, 2)
  tasks.cancel(1, { runId: a.runId }); assert.equal((await wait(tasks, a.runId)).run.state, 'cancelled')
  assert.equal(tasks.getRun(1, { runId: b.runId }).run.state, 'running')
  assert.throws(() => tasks.cancel(2, { runId: b.runId }), { code: 'FORBIDDEN' })
  tasks.disposeOwner(1); assert.equal((await wait(tasks, b.runId)).run.state, 'cancelled')
  assert.equal(f.backend.chats.getRun(b.runId).modelId, choice.modelId)
  assert.equal(tasks.listActive(1, {}).length, 0)
})

test('uncertain write audits stop execution without offering a replay or storing raw results', async t => {
  const f = await firstPartyFixture(t), input = start('Add a note'), events: AgentRunEvent[] = []
  f.flag('fail-audit-finish')
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    yield* batch({ id: 'note', name: 'application.add_note', arguments: { requestId: randomUUID(), jobId: f.job.id, text: 'Uncertain committed note' } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, input, e => events.push(e)), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'failed'); assert.equal(snapshot.run.error, 'TOOL_AUDIT_UNAVAILABLE'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.at(-1)?.state, 'uncertain')
  assert.equal(f.backend.applications.listEvents({ jobId: f.job.id }).total, 1)
  assert(!JSON.stringify(snapshot).includes('Uncertain committed note'))
  assert.equal(events.at(-1)?.type, 'run.failed')
})

test('Ask AI imports a job and completes the entire resume and output workflow beyond eight turns', async t => {
  const f = await firstPartyFixture(t), events: AgentRunEvent[] = []
  let jobId = '', runId = '', artifactId = '', step = 0
  const writing = { summary: { id: randomUUID(), text: f.fact.content, factIds: [f.fact.id] }, experience: [], projects: [], education: [], skills: [] }
  const requestId = randomUUID()
  const plan: (() => [string, unknown])[] = [
    () => ['job.import', { requestId, details: { title: 'PRIVATE_IMPORTED_JOB', companyNameRaw: 'PRIVATE_IMPORTED_COMPANY' } }],
    () => ['resume.start', { requestId: randomUUID(), jobId, profileId: f.profile.id }],
    () => ['resume.get_context', { runId }],
    () => ['resume.list_facts', { runId }],
    () => ['resume.submit_scores', { runId, language: 'en', scores: [{ factId: f.fact.id, score: 95, reason: 'PRIVATE_SCORE_REASON' }] }],
    () => ['resume.submit_gate', { runId, gate: { passed: true, reason: 'Supported', missingRequirements: [] } }],
    () => ['resume.submit_selection', { runId, selection: { factIds: [f.fact.id], itemIds: [f.item.id], wordBudget: 500 } }],
    () => ['resume.submit_draft', { runId, writing }],
    () => ['resume.submit_polished', { runId, writing }],
    () => ['resume.publish', { runId }],
    () => ['artifact.get', { id: artifactId }],
    () => ['artifact.build', { artifactId }]
  ]
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
    const previous = input.messages.at(-1)
    if (previous?.role === 'tool') {
      const result = JSON.parse(previous.content)
      assert.equal(result.error ?? null, null)
      if (step === 1) jobId = result.id
      if (step === 2) runId = result.runId
      if (step === 10) artifactId = result.artifact.id
      if (step === 12) {
        assert.equal(result.output.status, 'READY')
        assert.deepEqual(result.files.map((file: { format: string }) => file.format).sort(), ['HTML', 'PDF'])
      }
    }
    if (step === plan.length) { yield* answer('Resume ready'); return }
    const [name, args] = plan[step++]()
    yield* batch({ id: `step-${step}`, name, arguments: args })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Save this job and create a tailored resume with HTML/PDF'), e => events.push(e))
  const snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
  assert.equal(step, plan.length); assert(snapshot.run.writeStarted)
  assert.equal(f.backend.jobs.getJob({ id: jobId }).title, 'PRIVATE_IMPORTED_JOB')
  assert.equal(f.backend.resumes.getRun({ id: runId }).run.status, 'SUCCEEDED')
  const artifact = f.backend.resumes.getArtifact({ id: artifactId })
  assert.equal(artifact.artifact.output.status, 'READY'); assert.equal(f.outputs(), 1)
  assert.equal(artifact.artifact.content.summary?.text, f.fact.content)
  assert.deepEqual(artifact.provenance[0].factIds, [f.fact.id])
  const calls = snapshot.items.filter(item => item.content.type === 'tool_call')
  assert.equal(calls.length, plan.length)
  for (const item of calls) { assert.equal(item.state, 'completed'); if (item.content.type === 'tool_call') assert.notEqual(item.content.display.key, 'tool') }
  for (const privateText of ['PRIVATE_IMPORTED_JOB', 'PRIVATE_IMPORTED_COMPANY', f.fact.content, 'PRIVATE_SCORE_REASON', f.outputDirectory]) assert(!JSON.stringify(snapshot).includes(privateText))
  assert(events.every((event, index) => event.eventSequence === index + 1))
})

test('Ask AI can cancel and fail its own resume runs without gaining another MCP session\'s lease', async t => {
  const f = await firstPartyFixture(t), signal = new AbortController().signal
  const other = await f.mcp.session('resume', signal)
  const foreign = await other.call('resume.start', { requestId: randomUUID(), jobId: f.job.id, profileId: f.profile.id }, signal) as { runId: string }
  for (const operation of ['resume.cancel', 'resume.fail']) {
    let step = 0, runId = ''
    const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream(input) {
      const previous = input.messages.at(-1)
      if (previous?.role === 'tool') {
        const result = JSON.parse(previous.content)
        if (step === 1) assert.equal(result.error, 'TOOL_FORBIDDEN')
        if (step === 2) { assert.equal(result.error ?? null, null); runId = result.runId }
        if (step === 3) assert.equal(result.status, operation === 'resume.cancel' ? 'CANCELLED' : 'FAILED')
      }
      const extra = operation === 'resume.fail' ? { error: 'VALIDATION_FAILED' } : {}
      if (step++ === 0) yield* batch({ id: 'foreign', name: operation, arguments: { runId: foreign.runId, ...extra } })
      else if (step === 2) yield* batch({ id: 'start', name: 'resume.start', arguments: { requestId: randomUUID(), jobId: f.job.id, profileId: f.profile.id } })
      else if (step === 3) yield* batch({ id: 'finish', name: operation, arguments: { runId, ...extra } })
      else yield* answer('Done')
    } }
    const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
    const ids = tasks.start(1, start('Stop this resume'), () => {}), snapshot = await wait(tasks, ids.runId)
    assert.equal(snapshot.run.state, 'completed', snapshot.run.error ?? '')
    assert.equal(f.backend.resumes.getRun({ id: runId }).run.status, operation === 'resume.cancel' ? 'CANCELLED' : 'FAILED')
  }
  assert.equal(f.backend.resumes.getRun({ id: foreign.runId }).run.status, 'RUNNING')
})

test('uncertain job import marks the new write and never replays it', async t => {
  const f = await firstPartyFixture(t)
  f.flag('fail-audit-finish')
  let calls = 0
  const model: StreamingAgentModel = { complete: async () => ({ content: '', toolCalls: [] }), async *stream() {
    calls++
    yield* batch({ id: 'import', name: 'job.import', arguments: { requestId: randomUUID(), details: { title: 'PRIVATE_UNCERTAIN_IMPORT', companyNameRaw: 'Fixture' } } })
  } }
  const tasks = createAskAgentTasks({ chats: f.backend.chats, mcp: f.mcp, model: () => model }); t.after(() => tasks.dispose())
  const ids = tasks.start(1, start('Save this job'), () => {}), snapshot = await wait(tasks, ids.runId)
  assert.equal(snapshot.run.error, 'TOOL_AUDIT_UNAVAILABLE'); assert(snapshot.run.writeStarted)
  assert.equal(snapshot.items.at(-1)?.state, 'uncertain'); assert.equal(calls, 1)
  assert.equal(f.backend.jobs.listJobs({ search: 'PRIVATE_UNCERTAIN_IMPORT' }).total, 1)
  assert(!JSON.stringify(snapshot).includes('PRIVATE_UNCERTAIN_IMPORT'))
})

test('Ask AI reads and writes shared Markdown through real MCP and records only knowledge summaries',async t=>{
  const f=await firstPartyFixture(t);let step=0,revision=''
  const model:StreamingAgentModel={complete:async()=>({content:'',toolCalls:[]}),async *stream(input){
    const previous=input.messages.at(-1)
    if(previous?.role==='tool'){
      const result=JSON.parse(previous.content);assert.equal(result.error??null,null)
      if(result.revision)revision=result.revision
      if(step===3)assert(result.items.some((item:{path:string})=>item.path==='interview/notes.md'))
    }
    const calls:[string,Record<string,unknown>][]=[['knowledge.mkdir',{path:'interview'}],['knowledge.write',{path:'interview/notes.md',content:'PRIVATE_KNOWLEDGE_BODY pricing',expectedRevision:null}],['knowledge.search',{query:'pricing'}],['knowledge.read',{path:'interview/notes.md'}],['knowledge.write',{path:'interview/notes.md',content:'PRIVATE_KNOWLEDGE_BODY final pricing',expectedRevision:revision}],['knowledge.retrieve',{query:'pricing',maxContext:500}],['knowledge.write',{path:'scratch.md',content:'scratch',expectedRevision:null}],['knowledge.delete',{path:'scratch.md',expectedRevision:revision,recursive:false}]]
    if(step===calls.length){yield* answer('Saved your note.');return}
    const [name,args]=calls[step++];yield* batch({id:`knowledge-${step}`,name,arguments:args})
  }}
  const tasks=createAskAgentTasks({chats:f.backend.chats,mcp:f.mcp,model:()=>model});t.after(()=>tasks.dispose())
  const ids=tasks.start(1,start('Save my interview preparation'),()=>{}),snapshot=await wait(tasks,ids.runId)
  assert.equal(snapshot.run.state,'completed',snapshot.run.error??'');assert(snapshot.run.writeStarted)
  const {readFileSync}=await import('node:fs');const {join}=await import('node:path');assert.equal(readFileSync(join(f.directory,'knowledge','interview','notes.md'),'utf8'),'PRIVATE_KNOWLEDGE_BODY final pricing')
  const text=JSON.stringify(snapshot);assert(!text.includes('PRIVATE_KNOWLEDGE_BODY'));assert(snapshot.items.filter(item=>item.content.type==='tool_call').every(item=>item.content.type==='tool_call'&&['knowledgeRead','knowledgeWrite'].includes(item.content.display.key)))
  assert(!JSON.stringify(f.backend.toolAudit.list()).includes('interview/notes.md'))
})
