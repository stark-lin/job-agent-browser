import { contextBridge, ipcRenderer } from 'electron'
import {
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_GET_STATE,
  BROWSER_NAVIGATE,
  BROWSER_STATE_CHANGED,
  type BrowserAPI,
  type BrowserState
} from '../shared/browser'

const browserAPI: BrowserAPI = {
  navigate: (input) => ipcRenderer.invoke(BROWSER_NAVIGATE, input),
  back: () => ipcRenderer.invoke(BROWSER_BACK),
  forward: () => ipcRenderer.invoke(BROWSER_FORWARD),
  getState: () => ipcRenderer.invoke(BROWSER_GET_STATE),
  onStateChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void => callback(state)
    ipcRenderer.on(BROWSER_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(BROWSER_STATE_CHANGED, listener)
  }
}

contextBridge.exposeInMainWorld('browser', browserAPI)
