import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { APPLICATION_CALL, applicationAgentMethods } from '../application-contract'
import type { ApplicationTasks } from '../application-tasks'
import { trustedDataSender } from './data-ipc'
import { resumeError } from '../resume-tasks'

export function registerApplicationIPC(service: ApplicationTasks, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(APPLICATION_CALL, (event, method: unknown, input: unknown) => {
    const sender = event.sender, frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame,
      url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    if (typeof method !== 'string' || !applicationAgentMethods.includes(method as typeof applicationAgentMethods[number])) return { ok: false, error: 'INVALID_INPUT' }
    try { return { ok: true, value: service[method as typeof applicationAgentMethods[number]](sender.id, input) } }
    catch (error) { return { ok: false, error: resumeError(error) } }
  })
}
