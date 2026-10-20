import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extractPdf, readPdf } from '../src/platform/profile-import/pdf'

const { pdfFixture } = require(resolve(process.cwd(), 'scripts/profile-fixtures.cjs')) as { pdfFixture: (options?: { pages?: number; scanned?: boolean; cjk?: boolean; columns?: boolean; encrypted?: boolean; lines?: number; text?: string }) => Buffer }
const worker = resolve(process.cwd(), 'src/platform/profile-import/pdf-worker.mjs')
const extract = (bytes: Uint8Array) => extractPdf(bytes, new AbortController().signal, () => {}, worker)
test('real PDF.js worker extracts multipage English, Chinese resources, and column reading order', async () => {
  const pages = await extract(pdfFixture({ pages: 2, columns: true }))
  assert.equal(pages.length, 2); assert.equal(pages[1].page, 2)
  assert.match(pages[0].text, /Candidate resume/)
  assert(pages[0].text.indexOf('Left 4') < pages[0].text.indexOf('Right 1'))
  const chinese = await extract(pdfFixture({ cjk: true }))
  assert.match(chinese[0].text, /候选人简历/)
})
test('real worker reports scans, corrupt/encrypted PDFs, page and text limits without truncation', async () => {
  await assert.rejects(extract(pdfFixture({ scanned: true })), /PDF_NO_TEXT/)
  await assert.rejects(extract(Buffer.from('%PDF-broken')), /PDF_INVALID/)
  await assert.rejects(extract(pdfFixture({ encrypted: true })), /PDF_ENCRYPTED/)
  await assert.rejects(extract(pdfFixture({ pages: 21 })), /PDF_TOO_MANY_PAGES/)
  await assert.rejects(extract(pdfFixture({ pages: 20, lines: 50, text: 'A'.repeat(70) })), /PDF_TOO_MUCH_TEXT/)
})
test('file reading enforces byte limits and headers; worker cancellation terminates extraction', async t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'profile-pdf-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = resolve(directory, 'resume.pdf')
  writeFileSync(path, Buffer.alloc(10 * 1024 * 1024 + 1))
  await assert.rejects(readPdf(path), /PDF_TOO_LARGE/)
  writeFileSync(path, 'not a PDF'); await assert.rejects(readPdf(path), /PDF_INVALID/)
  writeFileSync(path, pdfFixture()); assert((await readPdf(path)).length > 0)
  const controller = new AbortController(), running = extractPdf(pdfFixture({ pages: 20 }), controller.signal, () => {}, worker)
  controller.abort(); await assert.rejects(running, /AI_CANCELLED/)
})
