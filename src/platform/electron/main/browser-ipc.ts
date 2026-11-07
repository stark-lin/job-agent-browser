import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { t } from '../../../shared/i18n'
import type { BrowserManager } from '../../browser/browserManager'
import { registerSelectionIPC } from './browser-selection-ipc'
import {
  BROWSER_BACK,
  BROWSER_RELOAD,
  BROWSER_COPY_WEBPAGE,
  BROWSER_CREATE_TAB,
  BROWSER_ACTIVATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE,
  BROWSER_SET_VISIBLE,
  BROWSER_SET_SIDEBAR_TOOLTIP,
  BROWSER_SET_UNSAVED,
} from '../../../shared/browser'

export function registerBrowserIPC(requireBrowser: () => BrowserManager, assertTrustedRenderer: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle(BROWSER_NAVIGATE, async (event, input: unknown) => {
    assertTrustedRenderer(event)
    if (typeof input !== 'string') throw new Error(t($ => $.errors.navigationInput))
    await requireBrowser().navigate(input)
  })
  ipcMain.handle(BROWSER_BACK, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().back()
  })
  ipcMain.handle(BROWSER_FORWARD, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().forward()
  })
  ipcMain.handle(BROWSER_RELOAD, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().reload()
  })
  ipcMain.handle(BROWSER_COPY_WEBPAGE, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().copyWebpage()
  })
  ipcMain.handle(BROWSER_GET_STATE, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().getState()
  })
  registerSelectionIPC(requireBrowser, assertTrustedRenderer)
  ipcMain.handle(BROWSER_SET_VISIBLE, (event, visible: unknown, presentation: unknown) => {
    assertTrustedRenderer(event)
    if (typeof visible !== 'boolean') throw new Error(t($ => $.errors.visibilityInput))
    if (!presentation || typeof presentation !== 'object' ||
      !('tabId' in presentation) || typeof presentation.tabId !== 'string' ||
      !('targetId' in presentation) || typeof presentation.targetId !== 'string') {
      throw new Error(t($ => $.errors.presentationInput))
    }
    requireBrowser().setVisible(visible, { tabId: presentation.tabId, targetId: presentation.targetId })
  })

  ipcMain.handle(BROWSER_SET_SIDEBAR_TOOLTIP, (event, input: unknown) => {
    assertTrustedRenderer(event)
    if (input === null) return requireBrowser().setSidebarTooltip(null)
    if (!input || typeof input !== 'object') return
    const { label, x, y, width, height } = input as Record<string, unknown>
    if (typeof label !== 'string' || label.length > 120 ||
      typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
      ![x, y, width, height].every(Number.isFinite)) return
    return requireBrowser().setSidebarTooltip({ label, x, y, width, height })
  })

  ipcMain.handle(BROWSER_SET_UNSAVED, (event, unsaved: unknown, presentation: unknown) => {
    assertTrustedRenderer(event)
    if (typeof unsaved !== 'boolean' || !presentation || typeof presentation !== 'object' ||
      !('tabId' in presentation) || typeof presentation.tabId !== 'string' || !('targetId' in presentation) || typeof presentation.targetId !== 'string') {
      throw new Error(t($ => $.errors.presentationInput))
    }
    requireBrowser().setUnsaved(unsaved, { tabId: presentation.tabId, targetId: presentation.targetId })
  })

  ipcMain.handle(BROWSER_CREATE_TAB, (event) => {
    assertTrustedRenderer(event)
    return requireBrowser().createTab()
  })
  ipcMain.handle(BROWSER_ACTIVATE_TAB, (event, id: unknown) => {
    assertTrustedRenderer(event)
    if (typeof id !== 'string') throw new Error(t($ => $.errors.tabIdInput))
    return requireBrowser().activateTab(id)
  })
  ipcMain.handle(BROWSER_CLOSE_TAB, (event, id: unknown) => {
    assertTrustedRenderer(event)
    if (typeof id !== 'string') throw new Error(t($ => $.errors.tabIdInput))
    return requireBrowser().closeTab(id)
  })
}
