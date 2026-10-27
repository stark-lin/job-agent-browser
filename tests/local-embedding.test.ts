import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { LocalEmbeddingProvider } from '../src/platform/knowledge/rag/local-embedding'
import { validVectors, type EmbeddingRequest } from '../src/platform/knowledge/rag/embedding-protocol'
class Child extends EventEmitter {
  requests: EmbeddingRequest[] = []
  killed = false
  postMessage(request: EmbeddingRequest) { this.requests.push(request) }
  kill() { this.killed = true; this.emit('exit', 1); return true }
  reply(vectors: number[][] = [Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)]) {
    this.emit('message', { id: this.requests.at(-1)!.id, ok: true, vectors })
  }
}
function fixture(timeoutMs = 1000) {
  let enabled = true, available = true
  const children: Child[] = []
  const provider = new LocalEmbeddingProvider({ enabled: () => enabled, available: () => available,
    modelsDirectory: '/models', timeoutMs, fork: () => { const c = new Child(); children.push(c); return c } })
  return { provider, children, enable: (v: boolean) => { enabled = v }, available: (v: boolean) => { available = v } }
}
const signal = () => new AbortController().signal
test('disabled or missing model never starts a process; disposal prevents restart', async () => {
  const f = fixture()
  f.enable(false)
  assert.equal(f.provider.identity(), null)
  await assert.rejects(f.provider.embed(['private'], 'query', signal()), /SEMANTIC_UNAVAILABLE/)
  f.enable(true); f.available(false)
  await assert.rejects(f.provider.embed(['private'], 'document', signal()))
  assert.equal(f.children.length, 0)
  f.available(true)
  await f.provider.dispose()
  await assert.rejects(f.provider.embed(['private'], 'query', signal()))
  assert.equal(f.children.length, 0)
})
test('lazy single process, serial inference and interactive priority', async () => {
  const f = fixture(), p = f.provider
  assert.equal(f.children.length, 0)
  const first = p.embed(['first'], 'document', signal())
  const background = p.embed(['background'], 'document', signal())
  const query = p.embed(['query'], 'query', signal())
  const child = f.children[0]
  assert.equal(child.requests.length, 1)
  child.reply(); await first
  assert.equal(child.requests.at(-1)!.purpose, 'query')
  child.reply(); await query
  assert.deepEqual(child.requests.at(-1)!.texts, ['background'])
  child.reply(); await background
  assert.equal(f.children.length, 1)
  await p.dispose(); assert(child.killed)
})
test('cancellation kills active inference; stale messages cannot complete replacement requests', async () => {
  const f = fixture(), abort = new AbortController()
  const first = f.provider.embed(['first'], 'document', abort.signal)
  const second = f.provider.embed(['second'], 'query', signal())
  const rejection = assert.rejects(first, /CANCELLED/)
  abort.abort(); await rejection
  assert(f.children[0].killed)
  f.children[0].reply()
  assert.equal(f.children.length, 2)
  f.children[1].reply(); await second
  await f.provider.dispose()
})
test('crashes, timeouts and malformed vectors reject and permit later recovery', async () => {
  const f = fixture(30)
  let pending = f.provider.embed(['text'], 'query', signal())
  let rejection = assert.rejects(pending, /PROCESS_EXITED/)
  f.children[0].emit('exit', 2); await rejection
  pending = f.provider.embed(['text'], 'query', signal())
  rejection = assert.rejects(pending, /FAILED/)
  f.children[1].reply([[NaN]]); await rejection
  await assert.rejects(f.provider.embed(['text'], 'query', signal()), /TIMEOUT/)
  assert(f.children[2].killed)
  pending = f.provider.embed(['text'], 'query', signal())
  f.children[3].reply(); await pending
  await f.provider.dispose()
  assert(!validVectors([Array(384).fill(0)], 1))
})
test('bounded queue rejects overflow and cancel releases every waiter', async () => {
  const f = fixture()
  const pending = Array.from({ length: 33 }, () => f.provider.embed(['text'], 'document', signal()))
  const checks = pending.map(p => assert.rejects(p, /CANCELLED/))
  await assert.rejects(f.provider.embed(['text'], 'query', signal()), /BUSY/)
  f.provider.cancel(); await Promise.all(checks)
  await f.provider.dispose()
})
