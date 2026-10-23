import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { DATA_CALL } from '../../../shared/ipc'
import type { Result } from '../../../shared/ipc'
import type { composeBackend } from '../../database/backend'
import type { ProfileImporter } from '../../profile-import/service'
import { errorCode } from '../../../domain/common/errors'
import { ImportFailure } from '../../profile-import/pdf'

export interface Sender {
  windowOwned: boolean; mainFrame: boolean; url: string
}

/** Exact document URL + top frame + owned webContents; external pages and subframes have no data access. */
export function trustedDataSender(sender: Sender, expectedURL: string): boolean {
  try {
    const actual = new URL(sender.url), expected = new URL(expectedURL)
    actual.hash = ''; expected.hash = ''
    return sender.windowOwned && sender.mainFrame && actual.href === expected.href
  } catch { return false }
}

export function registerDataIPC(backend: ReturnType<typeof composeBackend>, rendererPath: string, importer?: ProfileImporter): void {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(DATA_CALL, (event: IpcMainInvokeEvent, group: unknown, method: unknown, input: unknown): Result<unknown> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const sender: Sender = { windowOwned: Boolean(window), mainFrame: event.senderFrame === event.sender.mainFrame, url: event.senderFrame?.url ?? '' }
    if (!trustedDataSender(sender, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    if (group === 'profiles' && method === 'applyImport') {
      try { return importer ? importer.apply(event.sender.id, input) : { ok: false, error: 'FORBIDDEN' } }
      catch (error) { return { ok: false, error: error instanceof ImportFailure && error.code === 'IMPORT_NOT_FOUND' ? 'NOT_FOUND' : errorCode(error) } }
    }
    return backend.dispatch(group, method, input)
  })
}
