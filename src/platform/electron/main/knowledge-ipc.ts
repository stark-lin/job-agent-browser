import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { trustedDataSender } from './data-ipc'
import { KNOWLEDGE_CALL, KNOWLEDGE_CHANGED, knowledgeMethods, type KnowledgeMethods } from '../knowledge-contract'
import type { KnowledgeService } from '../../knowledge/service'
export function registerKnowledgeIPC(service: KnowledgeService, rendererPath: string) {
  const expected = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  const trusted = (event: IpcMainInvokeEvent) =>
    trustedDataSender(
      {
        windowOwned: Boolean(BrowserWindow.fromWebContents(event.sender)),
        mainFrame: event.senderFrame === event.sender.mainFrame,
        url: event.senderFrame?.url ?? ''
      },
      expected
    )
  ipcMain.handle(KNOWLEDGE_CALL, (event, method: unknown, input: unknown) => {
    if (!trusted(event)) return { ok: false, error: 'FORBIDDEN' }
    if (
      typeof method !== 'string' ||
      !knowledgeMethods.includes(method as keyof KnowledgeMethods) ||
      Buffer.byteLength(JSON.stringify(input) ?? '') > 600000
    )
      return { ok: false, error: 'KNOWLEDGE_INVALID_PATH' }
    return service.call(method as keyof KnowledgeMethods, input as KnowledgeMethods[keyof KnowledgeMethods]['input'])
  })
  return service.onChanged(() => {
    for (const window of BrowserWindow.getAllWindows())
      if (trustedDataSender({ windowOwned: true, mainFrame: true, url: window.webContents.getURL() }, expected))
        window.webContents.send(KNOWLEDGE_CHANGED)
  })
}
