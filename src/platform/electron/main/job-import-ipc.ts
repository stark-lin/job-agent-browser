import { BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { trustedDataSender } from './data-ipc'
import { JOB_IMPORT_START, JOB_IMPORT_CANCEL, JOB_IMPORT_EVENT, JOB_IMPORT_RETRY, JOB_IMPORT_SELECT, JOB_IMPORT_SAVE, JOB_IMPORT_GET } from '../../../shared/job-import'
import type { JobImporter } from '../../job-import/service'
import { JobImportFailure } from '../../job-import/errors'
import { ImportFailure, readPdf } from '../../import/pdf'
import { resumeError } from '../resume-tasks'

export function registerJobImportIPC(service: JobImporter, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  for (const channel of [JOB_IMPORT_START, JOB_IMPORT_CANCEL, JOB_IMPORT_RETRY, JOB_IMPORT_SELECT, JOB_IMPORT_SAVE, JOB_IMPORT_GET]) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const sender = event.sender, frame = event.senderFrame, window = BrowserWindow.fromWebContents(sender)
      const trusted = () => !sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame
      if (!trustedDataSender({ windowOwned: Boolean(window), mainFrame: frame === sender.mainFrame,
        url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
      try {
        if (channel === JOB_IMPORT_SELECT) {
          const selected = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
          if (selected.canceled || !selected.filePaths[0]) return { ok: true, value: null }
          const bytes = await readPdf(selected.filePaths[0])
          if (!trusted()) return { ok: false, error: 'FORBIDDEN' }
          return { ok: true, value: service.select(sender.id, bytes) }
        }
        if (channel === JOB_IMPORT_START) return { ok: true, value: service.start(sender.id, input, message => {
          if (trusted()) frame!.send(JOB_IMPORT_EVENT, message)
        }) }
        if (channel === JOB_IMPORT_SAVE) return { ok: true, value: await service.save(sender.id, input) }
        if (channel === JOB_IMPORT_GET) return { ok: true, value: service.getTask(sender.id, input) }
        if (channel === JOB_IMPORT_RETRY) return { ok: true, value: service.retry(sender.id, input) }
        service.cancel(sender.id, input)
        return { ok: true, value: null }
      } catch (error) { return { ok: false, error: error instanceof JobImportFailure || error instanceof ImportFailure ? error.code : resumeError(error) } }
    })
  }
}
