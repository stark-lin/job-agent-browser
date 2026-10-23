import { BrowserWindow, session } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { abortable } from '../../shared/agent'
import { compileHTML } from './compiler'
import { paginateDocument } from './paginate'
import type { ResumeDocument } from '../../domain/resume/resume.types'

/** No preload, Node access, remote requests, page scripts, navigation or persistent session. */
export async function exportDocument(document: ResumeDocument, fontDirectory: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const font = await readFile(join(fontDirectory, 'NotoSansSC.ttf'))
  const manifest = JSON.parse(await readFile(join(fontDirectory, 'version.json'), 'utf8')) as { sha256: string }
  if (createHash('sha256').update(font).digest('hex') !== manifest.sha256) throw new Error('FONT_VERSION_MISMATCH')
  const source = compileHTML(document, { id: 'default-v1', fontVersion: 'noto-sc-v1', fontBase64: font.toString('base64') })
  const isolated = session.fromPartition(`resume-${randomUUID()}`)
  const documentURL = 'resume-document://preview/'
  isolated.protocol.handle('resume-document', request => request.url === documentURL ? new Response(source, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response(null, { status: 404 }))
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' && details.url !== documentURL }))
  const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: true, backgroundThrottling: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  const timeout = AbortSignal.timeout(60000), bounded = AbortSignal.any([signal, timeout])
  const cancel = () => { if (!window.isDestroyed()) window.destroy() }
  bounded.addEventListener('abort', cancel, { once: true })
  try {
    await abortable(window.loadURL(documentURL), bounded)
    const result = await abortable(window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${paginateDocument.toString()})()` }]), bounded) as { html: string; pages: number }
    const pdf = await abortable(window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, generateTaggedPDF: true }), bounded)
    bounded.throwIfAborted()
    return { ...result, pdf }
  } finally { bounded.removeEventListener('abort', cancel); cancel(); isolated.protocol.unhandle('resume-document'); await isolated.closeAllConnections() }
}
