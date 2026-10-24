import { parentPort, workerData } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// A dedicated Main-owned worker contains PDF parsing and can be terminated on cancel.
const packageRoot = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
const send = value => parentPort.postMessage(value)
function pageText(items, width) {
  const rows = []
  for (const item of items.filter(item => 'str' in item && item.str.trim())) {
    const y = item.transform[5], x = item.transform[4]
    let row = rows.find(row => Math.abs(row.y - y) < Math.max(2, item.height * .25))
    if (!row) { row = { y, items: [] }; rows.push(row) }
    row.items.push({ x, end: x + item.width, text: item.str })
  }
  const lines = rows.sort((a, b) => b.y - a.y).flatMap(row => {
    const segments = []; let segment
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      if (!segment || item.x - segment.end > width * .12) {
        segment = { x: item.x, end: item.end, y: row.y, text: item.text }; segments.push(segment)
      } else { segment.text += ` ${item.text}`; segment.end = item.end }
    }
    return segments
  })
  const splitRows = rows.filter(row => row.items.some(item => item.x > width * .5) && row.items.some(item => item.end < width * .5))
  if (splitRows.length >= 3) {
    const left = lines.filter(line => line.end <= width * .5)
    const right = lines.filter(line => line.x >= width * .5)
    const spanning = lines.filter(line => !left.includes(line) && !right.includes(line))
    const top = Math.max(...left.map(line => line.y), ...right.map(line => line.y))
    return [...spanning.filter(line => line.y >= top), ...left, ...right, ...spanning.filter(line => line.y < top)].map(line => line.text).join('\n')
  }
  return lines.map(line => line.text).join('\n')
}
let loading
try {
  loading = getDocument({ data: new Uint8Array(workerData), isEvalSupported: false, useSystemFonts: false,
    cMapUrl: join(packageRoot, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: join(packageRoot, 'standard_fonts') + '/', wasmUrl: join(packageRoot, 'wasm') + '/' })
  const pdf = await loading.promise
  if (pdf.numPages > 20) throw new Error('PDF_TOO_MANY_PAGES')
  const pages = []; let total = 0
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number), content = await page.getTextContent()
    const text = pageText(content.items, page.getViewport({ scale: 1 }).width)
    total += text.length
    if (total > 60000) throw new Error('PDF_TOO_MUCH_TEXT')
    pages.push({ page: number, text }); page.cleanup()
    send({ type: 'progress', page: number, pages: pdf.numPages })
  }
  if (!pages.some(page => page.text.trim())) throw new Error('PDF_NO_TEXT')
  send({ type: 'done', pages })
} catch (error) {
  const code = error?.name === 'PasswordException' ? 'PDF_ENCRYPTED'
    : ['PDF_TOO_MANY_PAGES', 'PDF_TOO_MUCH_TEXT', 'PDF_NO_TEXT'].includes(error?.message) ? error.message : 'PDF_INVALID'
  send({ type: 'error', error: code })
} finally { await loading?.destroy(); parentPort.close() }
