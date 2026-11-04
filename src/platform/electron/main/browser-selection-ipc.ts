import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { BROWSER_PEEK_SELECTION, BROWSER_ACK_SELECTION, type Presentation } from '../../../shared/browser'
import { t } from '../../../shared/i18n'
import type { BrowserManager } from '../../browser/browserManager'

export function registerSelectionIPC(requireBrowser: () => BrowserManager, assertTrustedRenderer: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle(BROWSER_PEEK_SELECTION, (event, input: unknown) => {
    assertTrustedRenderer(event)
    return requireBrowser().peekSelection(selectionPresentation(input))
  })
  ipcMain.handle(BROWSER_ACK_SELECTION, (event, input: unknown) => {
    assertTrustedRenderer(event)
    const presentation = selectionPresentation(input)
    if (!input || typeof input !== 'object' || !('id' in input) || typeof input.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id)) throw new Error(t($ => $.errors.presentationInput))
    requireBrowser().ackSelection({ ...presentation, id: input.id })
  })
}

function selectionPresentation(input: unknown): Presentation {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('tabId' in input) || typeof input.tabId !== 'string' ||
    !('targetId' in input) || typeof input.targetId !== 'string' || input.tabId.length > 100 || input.targetId.length > 200) throw new Error(t($ => $.errors.presentationInput))
  return { tabId: input.tabId, targetId: input.targetId }
}
