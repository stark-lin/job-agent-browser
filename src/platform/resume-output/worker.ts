import { app } from 'electron'
import { isAbsolute } from 'node:path'
import { content } from '../../domain/resume/resume.validation'
import { exportDocument } from './exporter'

if (process.env.JOB_BROWSER_RENDER_DATA) app.setPath('userData', process.env.JOB_BROWSER_RENDER_DATA)

// This worker owns only rendering. Its parent owns SQLite, output paths and cancellation.
const deadline = setTimeout(() => app.exit(1), 65000)
app.on('window-all-closed', () => {})
if (process.platform === 'darwin') app.dock?.hide()
process.once('disconnect', () => app.exit(1))
process.once('message', (value: unknown) => {
  void (async () => {
    if (!value || typeof value !== 'object' || !('document' in value) || !('fonts' in value) || typeof value.fonts !== 'string' || !isAbsolute(value.fonts)) throw new Error('INVALID_WORKER_INPUT')
    const document = content(value.document)
    await app.whenReady()
    const result = await exportDocument(document, value.fonts, AbortSignal.timeout(60000))
    process.send?.({ html: result.html, pdf: result.pdf.toString('base64'), pages: result.pages }, error => { clearTimeout(deadline); app.exit(error ? 1 : 0) })
  })().catch(() => { clearTimeout(deadline); app.exit(1) })
})

process.send?.({ ready: true })
