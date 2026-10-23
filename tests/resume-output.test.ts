import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { compileHTML, safeLink } from '../src/platform/resume-output/compiler'
import { artifactFiles } from '../src/platform/resume-output/files'
import { published } from './helpers'

test('HTML compiler is deterministic, escaped, local-only and rejects dangerous link protocols', async t => {
  const f = await published(t), document = structuredClone(f.content)
  document.basics.name = '<img src=x onerror=alert(1)> & "name"'
  document.summary.text = '<script>alert(1)</script>'
  document.basics.links = [{ label: '<script>', url: 'javascript:alert(1)' }]
  const template = { id: 'default-v1' as const, fontVersion: 'noto-sc-v1' as const, fontBase64: 'AAAA' }
  const html = compileHTML(document, template)
  assert.equal(html, compileHTML(structuredClone(document), template))
  assert(!html.includes('<script>')); assert(!html.includes('<img')); assert(!html.includes('javascript:'))
  assert(html.includes('&lt;script&gt;')); assert(html.includes("script-src 'none'")); assert(html.includes('font-src data:'))
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'https://user:secret@example.com']) assert.equal(safeLink(url), null)
  assert.equal(safeLink('https://example.com/a'), 'https://example.com/a')
})
test('managed file output is atomic, constrained to artifact root, symlink-safe and cancelled before replacement', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'resume-output-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'artifacts'), store = artifactFiles(root), id = randomUUID(), signal = new AbortController().signal
  const files = await store.write(id, { html: 'safe html', pdf: Buffer.from('safe pdf') }, signal)
  assert.deepEqual(files.map(file => file.format), ['HTML', 'PDF'])
  assert.equal((await store.read(files[0].relativePath)).toString(), 'safe html')
  for (const path of ['../outside.pdf', '/tmp/x.pdf', 'a/../../x', 'a//x', 'a/./x']) await assert.rejects(store.read(path), /INVALID_OUTPUT_PATH/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(store.write(id, { html: 'replace', pdf: Buffer.from('replace') }, cancelled.signal))
  assert.equal((await readFile(join(root, files[0].relativePath))).toString(), 'safe html')
  const other = randomUUID(); await mkdir(join(directory, 'outside')); await symlink(join(directory, 'outside'), join(root, other))
  await assert.rejects(store.write(other, { html: 'escape', pdf: Buffer.from('escape') }, signal), /INVALID_OUTPUT_PATH/)
})
