import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { EXTERNAL_MCP_CALL } from '../../../shared/external-mcp'
import type { ExternalMCPInstaller } from '../../mcp/external-install'
import { externalMCPError } from '../../mcp/external-config'
import { trustedDataSender } from './data-ipc'

export function registerExternalMCPIPC(service: ExternalMCPInstaller, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(EXTERNAL_MCP_CALL, async (event, method: unknown, input: unknown) => {
    const sender = event.sender, frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame,
      url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    try {
      if (method === 'test') return { ok: true, value: await service.test(sender.id, input) }
      if (method === 'inspect' || method === 'install' || method === 'copy') return { ok: true, value: await service[method](input) }
      return { ok: false, error: 'INVALID_INPUT' }
    } catch (error) { return { ok: false, error: externalMCPError(error) } }
  })
}
