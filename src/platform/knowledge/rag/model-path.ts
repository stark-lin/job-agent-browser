import { app, utilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { manifest } from './embedding-protocol'
import { LocalEmbeddingProvider } from './local-embedding'

export function createKnowledgeEmbeddings(enabled: () => boolean) {
  const modelsDirectory = app.isPackaged ? join(process.resourcesPath, 'models') : join(app.getAppPath(), '.cache', 'models')
  return new LocalEmbeddingProvider({
    enabled, modelsDirectory,
    available: () => manifest.files.every(file => existsSync(join(modelsDirectory, manifest.id, file.path))),
    fork: () => utilityProcess.fork(join(app.getAppPath(), 'out/main/embedding-process.js'), [], { serviceName: 'JAB Local Embedding', stdio: 'pipe' })
  })
}
