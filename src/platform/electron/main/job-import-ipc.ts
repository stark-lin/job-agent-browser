import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { trustedDataSender } from './data-ipc'
import { JOB_IMPORT_START, JOB_IMPORT_CANCEL, JOB_IMPORT_EVENT } from '../../../shared/job-import'
import type { JobImporter } from '../../job-import/service'
import { JobImportFailure } from '../../job-import/errors'
import { aiError } from '../../ai'

export function registerJobImportIPC(service: JobImporter, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  for (const channel of [JOB_IMPORT_START, JOB_IMPORT_CANCEL]) {
    ipcMain.handle(channel, (event, input: unknown) => {
      const sender = event.sender, frame = event.senderFrame
      if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame,
        url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
      try {
        if (channel === JOB_IMPORT_START) return { ok: true, value: service.start(sender.id, input, message => {
          if (!sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame) frame.send(JOB_IMPORT_EVENT, message)
        }) }
        service.cancel(sender.id, input)
        return { ok: true, value: null }
      } catch (error) { return { ok: false, error: error instanceof JobImportFailure ? error.code : aiError(error) } }
    })
  }
}
