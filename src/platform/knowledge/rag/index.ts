import { existsSync, lstatSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import lockfile from 'proper-lockfile'
import type {
  KnowledgeChunk,
  KnowledgeHit,
  KnowledgeNode,
  KnowledgeSearch,
  KnowledgeContext
} from '../../../domain/knowledge'
import { hash } from '../paths'
import { KnowledgeFiles } from '../filesystem'
import { chunkMarkdown, approximateTokens } from './chunker'
import { cosine, type EmbeddingProvider } from './embedding'
interface Row {
  id: string
  path: string
  title: string
  heading: string
  ordinal: number
  content: string
  start: number
  end: number
  hash: string
  revision: string
}
function chunk(r: Row): KnowledgeChunk {
  return {
    id: r.id,
    path: r.path,
    fileTitle: r.title,
    headingPath: JSON.parse(r.heading) as string[],
    chunkIndex: r.ordinal,
    content: r.content,
    startLine: r.start,
    endLine: r.end,
    contentHash: r.hash
  }
}
export class KnowledgeIndex {
  private db?: DatabaseSync
  private diskIdentity = ''
  private queue: Promise<unknown> = Promise.resolve()
  readonly abort = new AbortController()
  error: string | null = null
  constructor(
    private files: KnowledgeFiles,
    private embedding?: EmbeddingProvider
  ) {}
  private connection() {
    const physical = join(this.files.directory, 'knowledge-index.sqlite')
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(physical + suffix) && lstatSync(physical + suffix).isSymbolicLink())
        throw new Error('INDEX_UNSAFE_PATH')
    const identity = existsSync(physical) ? String(lstatSync(physical).ino) : ''
    if (this.db && identity !== this.diskIdentity) {
      this.db.close()
      this.db = undefined
    }
    if (!this.db) {
      const db = new DatabaseSync(join(this.files.directory, 'knowledge-index.sqlite'))
      try {
        db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;')
        const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
        if (version > 1) throw new Error('INDEX_VERSION_UNSUPPORTED')
        db.exec(`PRAGMA user_version=1;CREATE TABLE IF NOT EXISTS knowledge_files(path TEXT PRIMARY KEY,hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_chunks(id TEXT PRIMARY KEY,path TEXT NOT NULL,title TEXT NOT NULL,heading TEXT NOT NULL,ordinal INTEGER NOT NULL,content TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,hash TEXT NOT NULL,revision TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS knowledge_path ON knowledge_chunks(path);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(id UNINDEXED,title,heading,content,path);
        CREATE TABLE IF NOT EXISTS knowledge_embeddings(chunk_id TEXT PRIMARY KEY,identity TEXT NOT NULL,hash TEXT NOT NULL,dimensions INTEGER NOT NULL,vector BLOB NOT NULL);`)
        this.db = db
        this.diskIdentity = String(lstatSync(physical).ino)
      } catch (error) {
        db.close()
        throw error
      }
    }
    return this.db
  }
  reconcile() {
    const job = this.queue.then(() => this.rebuildIncremental())
    this.queue = job.catch(() => {})
    return job
  }
  private async rebuildIncremental() {
    if (this.abort.signal.aborted) return
    await this.files.initialize()
    const db = this.connection()
    const release = await lockfile.lock(join(this.files.directory, 'knowledge-index.sqlite'), {
      stale: 30000,
      update: 5000,
      retries: { retries: 20, minTimeout: 50, maxTimeout: 200 }
    })
    try {
      const tree = await this.files.tree(),
        paths: string[] = []
      const walk = (n: KnowledgeNode) => {
        if (n.type === 'file') paths.push(n.path)
        n.children?.forEach(walk)
      }
      walk(tree)
      for (const path of paths) {
        this.abort.signal.throwIfAborted()
        const f = await this.files.read(path)
        if (
          (db.prepare('SELECT hash FROM knowledge_files WHERE path=?').get(path) as { hash: string } | undefined)
            ?.hash === f.revision
        )
          continue
        const chunks = await chunkMarkdown(path, f.content)
        // Never commit parse results after a newer external version has arrived.
        if ((await this.files.read(path)).revision !== f.revision) continue
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('DELETE FROM knowledge_chunks WHERE path=?').run(path)
          db.prepare('DELETE FROM knowledge_chunks_fts WHERE path=?').run(path)
          for (const c of chunks) {
            db.prepare('INSERT INTO knowledge_chunks VALUES(?,?,?,?,?,?,?,?,?,?)').run(
              c.id,
              path,
              c.fileTitle,
              JSON.stringify(c.headingPath),
              c.chunkIndex,
              c.content,
              c.startLine,
              c.endLine,
              c.contentHash,
              f.revision
            )
            db.prepare('INSERT INTO knowledge_chunks_fts VALUES(?,?,?,?,?)').run(
              c.id,
              c.fileTitle,
              c.headingPath.join(' > '),
              c.content,
              path
            )
          }
          db.prepare(
            'DELETE FROM knowledge_embeddings WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.id=chunk_id AND c.hash=knowledge_embeddings.hash)'
          ).run()
          db.prepare('INSERT OR REPLACE INTO knowledge_files VALUES(?,?)').run(path, f.revision)
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      }
      const existing = new Set(paths)
      for (const row of db.prepare('SELECT path FROM knowledge_files').all())
        if (!existing.has(String(row.path))) {
          const path = String(row.path)
          db.exec('BEGIN IMMEDIATE')
          try {
            db.prepare(
              'DELETE FROM knowledge_embeddings WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE path=?)'
            ).run(path)
            db.prepare('DELETE FROM knowledge_chunks WHERE path=?').run(path)
            db.prepare('DELETE FROM knowledge_chunks_fts WHERE path=?').run(path)
            db.prepare('DELETE FROM knowledge_files WHERE path=?').run(path)
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
        }
      this.error = null
    } catch (e) {
      this.error = 'INDEX_FAILED'
      throw e
    } finally {
      await release()
    }
  }
  async indexEmbeddings() {
    const identity = this.embedding?.identity()
    if (!identity || this.abort.signal.aborted) return
    const db = this.connection(),
      rows = db
        .prepare(
          `SELECT c.* FROM knowledge_chunks c LEFT JOIN knowledge_embeddings e ON c.id=e.chunk_id WHERE e.chunk_id IS NULL OR e.identity<>? OR e.hash<>c.hash LIMIT 5000`
        )
        .all(identity) as unknown as Row[]
    try {
      for (let i = 0; i < rows.length; i += 16) {
        if (this.embedding?.identity() !== identity || this.abort.signal.aborted) return
        const batch = rows.slice(i, i + 16),
          vectors = await this.embedding!.embed(
            batch.map((r) => `${r.title}\n${JSON.parse(r.heading).join(' > ')}\n${r.content}`),
            this.abort.signal
          )
        if (this.embedding?.identity() !== identity) return
        for (let n = 0; n < batch.length; n++) {
          const r = batch[n],
            vector = new Float32Array(vectors[n])
          db.prepare(
            `INSERT OR REPLACE INTO knowledge_embeddings SELECT id,?,?,?,? FROM knowledge_chunks WHERE id=? AND hash=?`
          ).run(identity, r.hash, vector.length, Buffer.from(vector.buffer), r.id, r.hash)
        }
      }
    } catch {
      this.error = 'SEMANTIC_UNAVAILABLE'
    }
  }
  async search(query: string, limit = 10, vector?: { identity: string; values: number[] }): Promise<KnowledgeSearch> {
    const db = this.connection()
    const ranks: string[][] = []
    const words = query.match(/[\p{L}\p{N}_]+/gu) ?? []
    if (words.length) {
      const fts = words
        .slice(0, 24)
        .map((w) => '"' + w.replaceAll('"', '""') + '"')
        .join(' OR ')
      ranks.push(
        db
          .prepare(
            'SELECT id FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH ? ORDER BY bm25(knowledge_chunks_fts) LIMIT 20'
          )
          .all(fts)
          .map((r) => String(r.id))
      )
    }
    const escaped = query.toLocaleLowerCase().replace(/[\\%_]/g, '\\$&'),
      terms = words.slice(0, 8)
    ranks.push(
      db
        .prepare(
          "SELECT id FROM knowledge_chunks WHERE lower(path) LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\' LIMIT 20"
        )
        .all('%' + escaped + '%', '%' + escaped + '%')
        .map((r) => String(r.id))
    )
    for (const term of terms.filter((w) => /[\p{Script=Han}]/u.test(w)))
      ranks.push(
        db
          .prepare("SELECT id FROM knowledge_chunks WHERE content LIKE ? ESCAPE '\\' ORDER BY path,ordinal LIMIT 20")
          .all('%' + term.replace(/[\\%_]/g, '\\$&') + '%')
          .map((r) => String(r.id))
      )
    let semantic = false
    if (vector) {
      const ranked: { id: string; score: number }[] = []
      for (const r of db
        .prepare('SELECT chunk_id,vector FROM knowledge_embeddings WHERE identity=? AND dimensions=?')
        .all(vector.identity, vector.values.length)) {
        const bytes = r.vector as Uint8Array,
          v = Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
        ranked.push({ id: String(r.chunk_id), score: cosine(vector.values, v) })
        if (ranked.length % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      semantic = ranked.length > 0
      ranks.push(
        ranked
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((v) => v.id)
      )
    }
    const scores = new Map<string, number>()
    for (const list of ranks) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i + 1)))
    const items: KnowledgeHit[] = []
    for (const [id, score] of [...scores].sort((a, b) => b[1] - a[1])) {
      const row = db.prepare('SELECT * FROM knowledge_chunks WHERE id=?').get(id) as unknown as Row | undefined
      if (!row) continue
      try {
        if ((await this.files.read(row.path)).revision !== row.revision) continue
      } catch {
        continue
      }
      items.push({ ...chunk(row), score, revision: row.revision })
      if (items.length === limit) break
    }
    return { items, semantic, total: items.length }
  }
  async retrieve(
    query: string,
    maxContext = 4000,
    vector?: { identity: string; values: number[] }
  ): Promise<KnowledgeContext> {
    const search = await this.search(query, 10, vector),
      sources: KnowledgeContext['sources'] = [],
      seen = new Set<string>()
    let used = 0,
      truncated = false
    const add = (path: string, startLine: number, endLine: number, content: string, revision: string) => {
      const id = `${path}:${startLine}:${endLine}:${hash(content)}`
      if (seen.has(id)) return
      seen.add(id)
      const cost = approximateTokens(content) + approximateTokens(path) + 24
      if (used + cost > maxContext) {
        truncated = true
        return
      }
      used += cost
      sources.push({ path, startLine, endLine, content, revision })
    }
    // Relevant hits get first claim on the budget.
    for (const hit of search.items) add(hit.path, hit.startLine, hit.endLine, hit.content, hit.revision)
    const db = this.connection()
    for (const hit of search.items) {
      const parts = hit.path.split('/')
      parts.pop()
      const parents = ['README.md', ...parts.map((_, i) => parts.slice(0, i + 1).join('/') + '/README.md')]
      for (const p of parents)
        if (p !== hit.path && !sources.some((source) => source.path === p)) {
          try {
            const f = await this.files.read(p)
            add(p, 1, f.content.split('\n').length, f.content, f.revision)
          } catch {
            /* Absent folder context is valid. */
          }
        }
      for (const row of db
        .prepare('SELECT * FROM knowledge_chunks WHERE path=? AND ordinal IN (?,?) ORDER BY ordinal')
        .all(hit.path, hit.chunkIndex - 1, hit.chunkIndex + 1) as unknown as Row[])
        if (row.revision === hit.revision) add(row.path, row.start, row.end, row.content, row.revision)
    }
    for (let i = sources.length - 1; i >= 0; i--) {
      try {
        if ((await this.files.read(sources[i].path)).revision !== sources[i].revision) sources.splice(i, 1)
      } catch {
        sources.splice(i, 1)
      }
    }
    return {
      sources,
      text: sources.map((s) => `[${s.path}:${s.startLine}-${s.endLine}]\n${s.content}`).join('\n\n'),
      semantic: search.semantic,
      truncated
    }
  }
  async queryVector(query: string) {
    const identity = this.embedding?.identity()
    if (!identity) return undefined
    try {
      const [values] = await this.embedding!.embed([query], this.abort.signal)
      return this.embedding?.identity() === identity ? { identity, values } : undefined
    } catch {
      return undefined
    }
  }
  async rebuild() {
    await this.queue
    const path = join(this.files.directory, 'knowledge-index.sqlite')
    const release = await lockfile.lock(path, {
      realpath: false,
      stale: 30000,
      update: 5000,
      retries: { retries: 20, minTimeout: 50, maxTimeout: 200 }
    })
    try {
      this.db?.close()
      this.db = undefined
      for (const suffix of ['', '-wal', '-shm']) await rm(path + suffix, { force: true })
    } finally {
      await release()
    }
    await this.reconcile()
    return null
  }
  async close() {
    this.abort.abort()
    await this.queue
    this.db?.close()
    this.db = undefined
  }
}
export async function brokerVector(directory: string, query: string) {
  try {
    const config = JSON.parse(await readFile(join(directory, 'knowledge-runtime', 'broker.json'), 'utf8')) as {
      port: number
      token: string
    }
    if (
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(config.token)
    )
      return undefined
    const response = await fetch(`http://127.0.0.1:${config.port}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(32000),
      redirect: 'error'
    })
    if (!response.ok) return undefined
    const result = (await response.json()) as { identity: string; values: number[] } | null
    return result &&
      typeof result.identity === 'string' &&
      Array.isArray(result.values) &&
      result.values.length <= 16384 &&
      result.values.every(Number.isFinite)
      ? result
      : undefined
  } catch {
    return undefined
  }
}
