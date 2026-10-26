import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { KNOWLEDGE_FLUSH, KNOWLEDGE_FLUSHED } from '../knowledge-contract'
/** Main owns the request and accepts an acknowledgement only from the same app webContents. */
export function flushKnowledge(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const id = randomUUID(),
      finish = (okay: boolean) => {
        clearTimeout(timer)
        ipcMain.removeListener(KNOWLEDGE_FLUSHED, listener)
        resolve(okay)
      }
    const listener = (event: Electron.IpcMainEvent, request: unknown, okay: unknown) => {
      if (event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && request === id)
        finish(okay === true)
    }
    const timer = setTimeout(() => finish(false), 10000)
    ipcMain.on(KNOWLEDGE_FLUSHED, listener)
    if (window.isDestroyed()) {
      finish(false)
      return
    }
    window.webContents.send(KNOWLEDGE_FLUSH, id)
  })
}
