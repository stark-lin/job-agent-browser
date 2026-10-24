import { createAskAgentBridge } from './ask-agent-bridge'
import { ASK_AGENT_CALL, ASK_AGENT_EVENT } from '../ask-agent-contract'
import type { AgentRunEvent } from '../../../domain/chat/chat.types'
import { contextBridge, ipcRenderer } from 'electron'
import { EXTERNAL_MCP_CALL } from '../../../shared/external-mcp'
import { createExternalMCPBridge } from './external-mcp-bridge'
import { createApplicationBridge } from './application-bridge'
import { APPLICATION_CALL } from '../application-contract'
import { createResumeBridge } from './resume-bridge'
import { RESUME_CALL, RESUME_EVENT, type ResumeEvent } from '../resume-contract'
import { createDataBridge } from './data-bridge'
import { DATA_CALL } from '../../../shared/ipc'
import { AI_START, AI_CANCEL, AI_EVENT, AI_MODELS, type AIEvent } from '../../../shared/ai'
import { createAIBridge } from './ai-bridge'
import type { JobImportAPI, JobImportEvent } from '../job-import-contract'
import { JOB_IMPORT_START, JOB_IMPORT_CANCEL, JOB_IMPORT_EVENT, JOB_IMPORT_RETRY, JOB_IMPORT_SELECT, JOB_IMPORT_SAVE, JOB_IMPORT_GET } from '../../../shared/job-import'
import type { ProfileImportAPI, ImportEvent } from '../profile-import-contract'
import { PROFILE_IMPORT_RETRY, PROFILE_IMPORT_SELECT, PROFILE_IMPORT_START, PROFILE_IMPORT_CANCEL, PROFILE_IMPORT_DISCARD, PROFILE_IMPORT_EVENT } from '../../../shared/profile-import'
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
  BROWSER_SET_UNSAVED,
  type BrowserAPI,
  type BrowserState
} from '../../../shared/browser'

const browserAPI: BrowserAPI = {
  setUnsaved: (unsaved, presentation) => ipcRenderer.invoke(BROWSER_SET_UNSAVED, unsaved, presentation),
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
contextBridge.exposeInMainWorld('externalMCP', createExternalMCPBridge((method, input) => ipcRenderer.invoke(EXTERNAL_MCP_CALL, method, input)))
const jobImport: JobImportAPI = {
  selectPdf: () => ipcRenderer.invoke(JOB_IMPORT_SELECT),
  save: input => ipcRenderer.invoke(JOB_IMPORT_SAVE, input),
  getTask: input => ipcRenderer.invoke(JOB_IMPORT_GET, input),
  retry: input => ipcRenderer.invoke(JOB_IMPORT_RETRY, input),
  start: input => ipcRenderer.invoke(JOB_IMPORT_START, input), cancel: input => ipcRenderer.invoke(JOB_IMPORT_CANCEL, input),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, message: JobImportEvent) => callback(message)
    ipcRenderer.on(JOB_IMPORT_EVENT, listener)
    return () => ipcRenderer.removeListener(JOB_IMPORT_EVENT, listener)
  }
}
contextBridge.exposeInMainWorld('jobImport', jobImport)
const profileImport: ProfileImportAPI = {
  retry: input => ipcRenderer.invoke(PROFILE_IMPORT_RETRY, input),
  selectPdf: () => ipcRenderer.invoke(PROFILE_IMPORT_SELECT),
  start: input => ipcRenderer.invoke(PROFILE_IMPORT_START, input), cancel: input => ipcRenderer.invoke(PROFILE_IMPORT_CANCEL, input),
  discard: input => ipcRenderer.invoke(PROFILE_IMPORT_DISCARD, input),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, message: ImportEvent) => callback(message)
    ipcRenderer.on(PROFILE_IMPORT_EVENT, listener)
    return () => ipcRenderer.removeListener(PROFILE_IMPORT_EVENT, listener)
  }
}
contextBridge.exposeInMainWorld('profileImport', profileImport)
contextBridge.exposeInMainWorld('data', createDataBridge((group, method, input) => ipcRenderer.invoke(DATA_CALL, group, method, input)))
contextBridge.exposeInMainWorld('ai', createAIBridge(
  (operation, input) => ipcRenderer.invoke(operation === 'start' ? AI_START : operation === 'models' ? AI_MODELS : AI_CANCEL, input),
  callback => {
    const listener = (_event: Electron.IpcRendererEvent, message: AIEvent) => callback(message)
    ipcRenderer.on(AI_EVENT, listener)
    return () => ipcRenderer.removeListener(AI_EVENT, listener)
  }
))

contextBridge.exposeInMainWorld('resume', createResumeBridge((method, input) => ipcRenderer.invoke(RESUME_CALL, method, input), callback => {
  const listener = (_event: Electron.IpcRendererEvent, message: ResumeEvent) => callback(message)
  ipcRenderer.on(RESUME_EVENT, listener)
  return () => ipcRenderer.removeListener(RESUME_EVENT, listener)
}))

contextBridge.exposeInMainWorld('applicationAgent', createApplicationBridge((method, input) => ipcRenderer.invoke(APPLICATION_CALL, method, input)))

contextBridge.exposeInMainWorld('askAgent', createAskAgentBridge((method, input) => ipcRenderer.invoke(ASK_AGENT_CALL, method, input), callback => {
  const listener = (_event: Electron.IpcRendererEvent, message: AgentRunEvent) => callback(message)
  ipcRenderer.on(ASK_AGENT_EVENT, listener)
  return () => ipcRenderer.removeListener(ASK_AGENT_EVENT, listener)
}))
