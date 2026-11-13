import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { AI_START, AI_CANCEL, AI_EVENT, AI_MODELS, AI_SAVE_CONNECTION } from '../../../shared/ai'
import { aiError, type AIService } from '../../ai'
import { trustedDataSender } from './data-ipc'
import { object } from '../../storage/validation'
import { saveAIConnection } from '../../ai/connection'
import { DataError } from '../../../domain/common/errors'
import { id } from '../../../domain/common/validation'

export function registerAIIPC(service: AIService, rendererPath: string, saveConnection: (input: unknown) => ReturnType<typeof saveAIConnection>): void {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  for (const channel of [AI_START, AI_CANCEL, AI_MODELS, AI_SAVE_CONNECTION]) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const sender = event.sender
      if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: event.senderFrame === sender.mainFrame, url: event.senderFrame?.url ?? '' }, expectedURL)) {
        return { ok: false, error: 'FORBIDDEN' }
      }
      try {
        if (channel === AI_SAVE_CONNECTION) return { ok: true, value: saveConnection(input) }
        if (channel === AI_MODELS) return { ok: true, value: await service.listModels(sender.id, input) }
        if (channel === AI_CANCEL) {
          service.cancel(sender.id, id(object(input, ['requestId']).requestId))
          return { ok: true, value: null }
        }
        const frame = event.senderFrame
        const value = service.start(sender.id, input, message => {
          if (!sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame) frame.send(AI_EVENT, message)
        })
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: channel === AI_SAVE_CONNECTION && !(error instanceof DataError) ? 'STORAGE_UNAVAILABLE' : aiError(error) }
      }
    })
  }
}
