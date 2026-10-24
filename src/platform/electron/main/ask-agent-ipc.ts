import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { ASK_AGENT_CALL, ASK_AGENT_EVENT, askAgentMethods } from '../ask-agent-contract'
import { askError, type AskAgentTasks } from '../ask-agent-tasks'
import { trustedDataSender } from './data-ipc'
export function registerAskAgentIPC(service: AskAgentTasks, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(ASK_AGENT_CALL, (event, method: unknown, input: unknown) => {
    const sender = event.sender, frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame, url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    if (typeof method !== 'string' || !askAgentMethods.includes(method as typeof askAgentMethods[number])) return { ok: false, error: 'INVALID_INPUT' }
    try {
      const value = method === 'start' ? service.start(sender.id, input, message => {
        if (!sender.isDestroyed() && frame && !frame.detached && sender.mainFrame === frame) frame.send(ASK_AGENT_EVENT, message)
      }) : method === 'cancel' ? service.cancel(sender.id, input) : method === 'getRun' ? service.getRun(sender.id, input) : service.listActive(sender.id, input)
      return { ok: true, value }
    } catch (error) { return { ok: false, error: askError(error) } }
  })
}
