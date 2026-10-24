import { BrowserWindow, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { EXTERNAL_SKILLS_CALL } from '../../../shared/external-skills'
import type { ExternalSkillsInstaller } from '../../skills/install'
import { skillsError } from '../../skills/tree'
import { trustedDataSender } from './data-ipc'

export function registerExternalSkillsIPC(service: ExternalSkillsInstaller, rendererPath: string) {
  const expectedURL = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  ipcMain.handle(EXTERNAL_SKILLS_CALL, async (event, method: unknown, input: unknown) => {
    const sender = event.sender, frame = event.senderFrame
    if (!trustedDataSender({ windowOwned: Boolean(BrowserWindow.fromWebContents(sender)), mainFrame: frame === sender.mainFrame,
      url: frame?.url ?? '' }, expectedURL)) return { ok: false, error: 'FORBIDDEN' }
    try {
      if (method === 'inspect' || method === 'install' || method === 'openBundle') return { ok: true, value: await service[method](input) }
      return { ok: false, error: 'INVALID_INPUT' }
    } catch (error) { return { ok: false, error: skillsError(error) } }
  })
}
