import { BrowserWindow, dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { trustedDataSender } from './data-ipc'
import type { ProfileImporter } from '../../profile-import/service'
import { ImportFailure, readPdf } from '../../profile-import/pdf'
import { aiError } from '../../ai'
import { DataError } from '../../../domain/common/errors'
import { PROFILE_IMPORT_CANCEL, PROFILE_IMPORT_DISCARD, PROFILE_IMPORT_EVENT, PROFILE_IMPORT_SELECT, PROFILE_IMPORT_START } from '../../../shared/profile-import'

export function registerProfileImportIPC(service: ProfileImporter, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  for (const channel of [PROFILE_IMPORT_SELECT, PROFILE_IMPORT_START, PROFILE_IMPORT_CANCEL, PROFILE_IMPORT_DISCARD]) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const sender = event.sender, window = BrowserWindow.fromWebContents(sender), frame = event.senderFrame
      if (!trustedDataSender({ windowOwned: Boolean(window), mainFrame: frame === sender.mainFrame, url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
      try {
        if (channel === PROFILE_IMPORT_SELECT) {
          const selected = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
          if (selected.canceled || !selected.filePaths[0]) return { ok: true, value: null }
          const bytes = await readPdf(selected.filePaths[0])
          if (sender.isDestroyed() || frame?.detached || sender.mainFrame !== frame) return { ok: false, error: 'FORBIDDEN' }
          return { ok: true, value: service.select(sender.id, bytes) }
        }
        if (channel === PROFILE_IMPORT_START) return { ok: true, value: service.start(sender.id, input, message => {
          if (!sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame) frame.send(PROFILE_IMPORT_EVENT, message)
        }) }
        if (channel === PROFILE_IMPORT_CANCEL) service.cancel(sender.id, input)
        else service.discard(sender.id, input)
        return { ok: true, value: null }
      } catch (error) { return { ok: false, error: error instanceof ImportFailure ? error.code : error instanceof DataError && ['INVALID_STATE', 'NOT_FOUND', 'CONFLICT'].includes(error.code) ? error.code : aiError(error) } }
    })
  }
}
