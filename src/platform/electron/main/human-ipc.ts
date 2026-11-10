import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { HUMAN_CALL, HUMAN_CHANGED } from '../human-contract'
import type { HumanRequests } from '../../mcp/human-requests'
import type { BrowserManager } from '../../browser/browserManager'
import { createHumanHandler } from '../human-handler'
import { trustedDataSender } from './data-ipc'

export function registerHumanIPC(service: HumanRequests, rendererPath: string, browser: () => BrowserManager | undefined) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  const handler = createHumanHandler(service), watched = new Set<number>()
  service.subscribe(() => {
    const pending = service.list()
    browser()?.setHumanDialogVisible(pending.length > 0)
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(HUMAN_CHANGED)
  })
  ipcMain.handle(HUMAN_CALL, (event, method: unknown, value: unknown) => {
    const sender = event.sender, frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame, url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    if (!watched.has(sender.id)) {
      watched.add(sender.id)
      const dispose = () => {
        handler.disposeOwner(sender.id)
        // Window loss invalidates waits, rather than submitting a normal cancelled answer.
        if (BrowserWindow.getAllWindows().every(window => window.webContents === sender || window.isDestroyed())) service.cancelAll()
        watched.delete(sender.id)
      }
      sender.on('destroyed', dispose); sender.on('render-process-gone', dispose); sender.on('did-navigate', dispose)
    }
    return handler.call(sender.id, true, method, value)
  })
}
