import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import http from 'isomorphic-git/http/node'
import { KnowledgeFiles } from '../src/platform/knowledge/filesystem'
import { KnowledgeBackup } from '../src/platform/knowledge/git/backup'
import { defaultKnowledgePreferences } from '../src/shared/knowledge-settings'
async function remote(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'jab-remote-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = join(root, 'backup.git')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', repo], { stdio: 'ignore' })
  execFileSync('git', ['-C', repo, 'config', 'http.receivepack', 'true'])
  let fail = false,
    denyConflict = false
  const server = createServer(async (req, res) => {
    if (fail) {
      res.writeHead(503).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const value of req) chunks.push(Buffer.from(value))
    const body = Buffer.concat(chunks)
    if (denyConflict && body.includes(Buffer.from('backup/conflict-'))) {
      res.writeHead(403).end()
      return
    }
    const url = new URL(req.url!, 'http://local'),
      child = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: '1',
          REQUEST_METHOD: req.method,
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          CONTENT_LENGTH: String(body.length),
          REMOTE_USER: 'fixture'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    const out: Buffer[] = []
    child.stdout.on('data', (v) => out.push(v))
    child.on('close', () => {
      const all = Buffer.concat(out),
        boundary = all.indexOf('\r\n\r\n')
      if (boundary < 0) {
        res.writeHead(500).end()
        return
      }
      const header = all.subarray(0, boundary).toString()
      let status = 200
      for (const line of header.split('\r\n')) {
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const name = line.slice(0, colon),
          value = line.slice(colon + 1).trim()
        if (name.toLowerCase() === 'status') status = parseInt(value)
        else res.setHeader(name, value)
      }
      res.writeHead(status).end(all.subarray(boundary + 4))
    })
    child.stdin.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  t.after(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  )
  const address = server.address()
  assert(address && typeof address !== 'string')
  const transport = {
    request: (options: Parameters<typeof http.request>[0]) =>
      http.request({
        ...options,
        url: options.url.replace('https://github.com/fixture/backup.git', `http://127.0.0.1:${address.port}/backup.git`)
      })
  }
  const directory = join(root, 'local')
  await mkdir(directory)
  const files = new KnowledgeFiles(directory)
  await files.initialize()
  const backup = new KnowledgeBackup(
    files,
    () => ({ ...defaultKnowledgePreferences, remote: 'https://github.com/fixture/backup.git' }),
    () => 'PRIVATE_TOKEN',
    transport
  )
  return {
    root,
    repo,
    files,
    backup,
    fail: () => {
      fail = true
    },
    denyConflict: () => {
      denyConflict = true
    },
    git: (...args: string[]) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@local.invalid',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@local.invalid'
        }
      }).trim()
  }
}
test('GitHub protocol backup handles empty remote, no-op, local ahead, remote ahead and divergence without overwriting either side', async (t) => {
  const f = await remote(t)
  assert.equal((await f.backup.sync()).state, 'synced')
  assert.equal((await f.backup.sync()).state, 'synced')
  const note = await f.files.write('note.md', 'local v1', null)
  assert.equal((await f.backup.sync()).state, 'synced')
  const clone = join(f.root, 'remote-edit')
  f.git('clone', f.repo, clone)
  await writeFile(join(clone, 'remote.md'), 'remote addition')
  f.git('-C', clone, 'add', '.')
  f.git('-C', clone, 'commit', '-m', 'Remote addition')
  f.git('-C', clone, 'push', 'origin', 'main')
  assert.equal((await f.backup.sync()).state, 'synced')
  assert.equal((await f.files.read('remote.md')).content, 'remote addition')
  await f.files.write('note.md', 'local divergence', (await f.files.read(note.path)).revision)
  await writeFile(join(clone, 'note.md'), 'remote divergence')
  f.git('-C', clone, 'add', '.')
  f.git('-C', clone, 'commit', '-m', 'Remote divergence')
  f.git('-C', clone, 'push', 'origin', 'main')
  const state = await f.backup.sync()
  assert.equal(state.state, 'conflict')
  assert(state.conflictBranch?.startsWith('backup/conflict-'))
  assert.equal((await f.files.read('note.md')).content, 'local divergence')
  assert.equal(f.git('--git-dir', f.repo, 'show', 'main:note.md'), 'remote divergence')
  assert.equal(f.git('--git-dir', f.repo, 'show', `${state.conflictBranch}:note.md`), 'local divergence')
  assert(!(await readFile(join(f.files.root, '.git', 'config'), 'utf8')).includes('PRIVATE_TOKEN'))
})
test('unrelated remote histories preserve both and rejected conflict uploads never report synced', async (t) => {
  const f = await remote(t),
    clone = join(f.root, 'seed')
  f.git('init', '--initial-branch=main', clone)
  await writeFile(join(clone, 'remote.md'), 'unrelated')
  f.git('-C', clone, 'add', '.')
  f.git('-C', clone, 'commit', '-m', 'Unrelated')
  f.git('-C', clone, 'remote', 'add', 'origin', f.repo)
  f.git('-C', clone, 'push', 'origin', 'main')
  await f.files.write('local.md', 'local', null)
  f.denyConflict()
  const state = await f.backup.sync()
  assert.equal(state.state, 'failed')
  assert.equal(state.error, 'CONFLICT_UPLOAD_FAILED')
  assert.equal((await f.files.read('local.md')).content, 'local')
  assert.equal(f.git('--git-dir', f.repo, 'show', 'main:remote.md'), 'unrelated')
})
test('network failure preserves Markdown and local recovery history', async (t) => {
  const f = await remote(t)
  await f.files.write('safe.md', 'safe', null)
  f.fail()
  assert.equal((await f.backup.sync()).state, 'failed')
  assert.equal((await f.files.read('safe.md')).content, 'safe')
  assert((await f.backup.history()).length > 0)
})
