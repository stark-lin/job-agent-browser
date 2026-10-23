import { BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { writeFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RESUME_CALL, RESUME_EVENT, resumeMethods, type ResumeEvent } from '../resume-contract'
import { trustedDataSender } from './data-ipc'
import { resumeError, type ResumeTasks } from '../../agent/resume-tasks'

export function registerResumeIPC(service: ResumeTasks, rendererPath: string) {
  const expected = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(RESUME_CALL, async (event, method: unknown, input: unknown) => {
    const sender = event.sender, window = BrowserWindow.fromWebContents(sender), frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(window), mainFrame: frame === sender.mainFrame, url: frame?.url ?? '' }, expected)) return { ok: false, error: 'FORBIDDEN' }
    if (typeof method !== 'string' || !(resumeMethods as readonly string[]).includes(method)) return { ok: false, error: 'INVALID_INPUT' }
    const emit = (message: ResumeEvent) => { if (!sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame) frame.send(RESUME_EVENT, message) }
    try {
      let value: unknown
      if (method === 'start') value = await service.start(sender.id, input, emit)
      else if (method === 'getTask') value = service.getTask(sender.id, input)
      else if (method === 'cancel') value = await service.cancel(sender.id, input)
      else if (method === 'retryOutput') value = service.retryOutput(sender.id, input, emit)
      else if (method === 'getPreview') value = await service.getPreview(input)
      else {
        const pdf = await service.pdf(input)
        const selected = await dialog.showSaveDialog(window!, { defaultPath: pdf.name, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
        if (selected.canceled || !selected.filePath) value = { saved: false }
        else {
          const temporary = join(dirname(selected.filePath), `.${randomUUID()}.tmp`)
          try { await writeFile(temporary, pdf.bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, selected.filePath) }
          finally { await rm(temporary, { force: true }) }
          value = { saved: true }
        }
      }
      return { ok: true, value }
    } catch (error) {
      const code = resumeError(error)
      return { ok: false, error: method === 'exportPdf' && code === 'VALIDATION_FAILED' ? 'PDF_EXPORT_FAILED' : code }
    }
  })
}
