import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { LocalEmbeddingProvider } from './local-embedding'
import type { LocalModelManager } from '../../models/manager'

export function createKnowledgeEmbeddings(enabled: () => boolean, manager: LocalModelManager) {
  return new LocalEmbeddingProvider({
    acquireLease: compromised => manager.acquireLease(compromised),
    enabled, modelsDirectory: manager.store.directory, available: () => manager.available(),
    fork: () => utilityProcess.fork(join(app.getAppPath(), 'out/main/embedding-process.js'), [], { serviceName: 'JAB Local Embedding', stdio: 'pipe' })
  })
}
