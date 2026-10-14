import { t } from '../../../shared/i18n'
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { BrowserManager } from '../../browser/browserManager'
import { themeBackground } from './theme'

export function createMainWindow(getInboxURL: () => string | null = () => null): { window: BrowserWindow; browser: BrowserManager } {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    title: t($ => $.app.title),
    backgroundColor: themeBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  window.removeMenu()

  const browser = new BrowserManager(window, getInboxURL)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebURL(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return { window, browser }
}

function isWebURL(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
