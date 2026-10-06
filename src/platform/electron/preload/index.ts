import { contextBridge, ipcRenderer } from 'electron'
import { createDataBridge } from './data-bridge'
import { DATA_CALL } from '../../../shared/ipc'
import {
  BROWSER_BACK,
  BROWSER_CREATE_TAB,
  BROWSER_ACTIVATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_FOCUS_ADDRESS,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE,
  BROWSER_STATE_CHANGED,
  BROWSER_SET_VISIBLE,
  type BrowserAPI,
  type BrowserState
} from '../../../shared/browser'

const browserAPI: BrowserAPI = {
  setVisible: (visible, presentation) => ipcRenderer.invoke(BROWSER_SET_VISIBLE, visible, presentation),
  navigate: (input) => ipcRenderer.invoke(BROWSER_NAVIGATE, input),
  back: () => ipcRenderer.invoke(BROWSER_BACK),
  forward: () => ipcRenderer.invoke(BROWSER_FORWARD),
  createTab: () => ipcRenderer.invoke(BROWSER_CREATE_TAB),
  activateTab: (id) => ipcRenderer.invoke(BROWSER_ACTIVATE_TAB, id),
  closeTab: (id) => ipcRenderer.invoke(BROWSER_CLOSE_TAB, id),
  getState: () => ipcRenderer.invoke(BROWSER_GET_STATE),
  onStateChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void => callback(state)
    ipcRenderer.on(BROWSER_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(BROWSER_STATE_CHANGED, listener)
  },
  onFocusAddress: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(BROWSER_FOCUS_ADDRESS, listener)
    return () => ipcRenderer.removeListener(BROWSER_FOCUS_ADDRESS, listener)
  }
}

contextBridge.exposeInMainWorld('browser', browserAPI)
contextBridge.exposeInMainWorld('data', createDataBridge((group, method, input) => ipcRenderer.invoke(DATA_CALL, group, method, input)))
