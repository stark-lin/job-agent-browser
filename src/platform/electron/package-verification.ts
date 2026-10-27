import { LocalModelManager } from '../models/manager'
import { manifest } from '../knowledge/rag/embedding-protocol'
import { verifyResumePackage } from './verify-resume-package'
import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { LocalEmbeddingProvider } from '../knowledge/rag/local-embedding'
import { cosine } from '../knowledge/rag/embedding'
import { KnowledgeService } from '../knowledge/service'
import { startKnowledgeBroker } from '../knowledge/broker'
import { createFirstPartyRuntime } from '../mcp/first-party-client'
import { createBackend } from '../database/backend'
import { defaultKnowledgePreferences } from '../../shared/knowledge-settings'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Package verification failed: ' + message)
}
export async function verifyEmbeddingRuntime(bundleDirectory: string, modelsDirectory: string, directory: string) {
  let provider: LocalEmbeddingProvider | undefined
  const manager = new LocalModelManager({ root: join(directory, 'managed-models'), seed: join(modelsDirectory, manifest.id), stop: () => provider?.stop(), activated() {} })
  await manager.ready
  check(manager.available(), 'verified seed imported into user store')
  const backend = createBackend(join(directory, 'database.sqlite'))
  let forks = 0
  provider = new LocalEmbeddingProvider({ acquireLease: compromised => manager.acquireLease(compromised), enabled: () => true, available: () => manager.available(), modelsDirectory: manager.store.directory,
    fork: () => {
      forks++
      const child = utilityProcess.fork(join(bundleDirectory, 'embedding-process.js'), [], { stdio: 'pipe' })
      child.stderr?.on('data', data => process.stderr.write(data))
      return child
    } })
  const service = new KnowledgeService(directory, { preferences: () => defaultKnowledgePreferences, embeddings: provider })
  const mcp = createFirstPartyRuntime(directory, bundleDirectory)
  let stop: (() => Promise<void>) | undefined
  try {
    await service.ready
    await service.files.write('company.md', '# Work\nTrip.com offers relatively flexible working conditions.', null)
    await service.files.write('database.md', '# Storage\nSQLite is an embedded relational database.', null)
    await service.index.reconcile()
    await service.index.indexEmbeddings()
    check(service.index.error === null, 'background embedding')
    const signal = AbortSignal.timeout(120000)
    const [a, b] = await provider.embed(['Trip.com offers relatively flexible working conditions.', 'SQLite is an embedded relational database.'], 'document', signal)
    const [query] = await provider.embed(['哪家公司工作环境相对灵活？'], 'query', signal)
    check(query.length === 384 && Math.abs(Math.hypot(...query) - 1) < 0.01, 'dimensions and normalization')
    check(cosine(query, a) > cosine(query, b), 'Chinese to English ranking')
    const company = await service.search('哪家公司工作环境相对灵活？')
    check(company.semantic && company.items[0]?.path === 'company.md', 'SQLite/RRF Chinese to English: ' + JSON.stringify(company.items.map(item => ({ path: item.path, score: item.score }))))
    await service.files.write('architecture.md', '# Architecture\n这个产品使用本地优先的数据架构，数据保存在用户设备上。', null)
    await service.index.reconcile()
    await service.index.indexEmbeddings()
    const architecture = await service.search('local-first data architecture')
    check(architecture.semantic && architecture.items[0]?.path === 'architecture.md', 'English to Chinese')
    stop = await startKnowledgeBroker(directory, service.index)
    const session = await mcp.session('ask-ai', signal)
    const result = await session.call('knowledge.retrieve', { query: '哪家公司工作环境相对灵活？', maxContext: 4000 }, signal)
    check(JSON.stringify(result).includes('company.md'), 'packaged stdio MCP and broker retrieval')
    check(forks === 1, 'one embedding process shared with MCP')
    await verifyResumePackage(backend, mcp, bundleDirectory)
    await manager.remove()
    check(manager.status().state === 'missing', 'model removal')
    const keyword = await service.search('SQLite')
    check(!keyword.semantic && keyword.items.some(item => item.path === 'database.md'), 'keyword fallback')
    return { ok: true, pdfVerified: true, dimensions: query.length, forks, platform: process.platform, arch: process.arch, electron: process.versions.electron }
  } finally {
    await stop?.()
    await mcp.dispose()
    await service.close()
    await provider.dispose()
    await manager.close()
    backend.close()
  }
}
export async function verifyMinimalRuntime(bundleDirectory: string, directory: string) {
  const backend = createBackend(join(directory, 'database.sqlite'))
  const manager = new LocalModelManager({ root: join(directory, 'managed-models'), stop() {}, activated() {} })
  await manager.ready
  check(manager.status().state === 'missing', 'optional model missing')
  const service = new KnowledgeService(directory, { preferences: () => defaultKnowledgePreferences })
  const mcp = createFirstPartyRuntime(directory, bundleDirectory)
  try {
    await service.ready
    await service.files.write('minimal.md', '# SQLite\nKeyword retrieval works without an embedding model.', null)
    const result = await service.search('SQLite')
    check(!result.semantic && result.items.some(item => item.path === 'minimal.md'), 'minimal keyword retrieval')
    const session = await mcp.session('ask-ai', AbortSignal.timeout(120000))
    const context = await session.call('knowledge.retrieve', { query: 'SQLite', maxContext: 4000 }, AbortSignal.timeout(120000))
    check(JSON.stringify(context).includes('minimal.md'), 'minimal MCP retrieval')
    await verifyResumePackage(backend, mcp, bundleDirectory)
    return { ok: true, pdfVerified: true, dimensions: 0, forks: 0, semanticAvailable: false, platform: process.platform, arch: process.arch, electron: process.versions.electron }
  } finally { await mcp.dispose(); await service.close(); await manager.close(); backend.close() }
}
export async function verifyPackageRuntime() {
  const bundle = join(app.getAppPath(), 'out/main'), directory = app.getPath('userData')
  const result = process.argv.includes('--verify-minimal') ? await verifyMinimalRuntime(bundle, directory) :
    await verifyEmbeddingRuntime(bundle, join(process.resourcesPath, 'models'), directory)
  await writeFile(join(app.getPath('userData'), 'package-verification.json'), JSON.stringify(result))
  console.log('Application runtime, MCP, PDF and keyword fallback verified.')
}
