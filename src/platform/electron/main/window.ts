import { mountBanner } from '../../banner/bannerView'
import type { BannerService } from '../../banner/bannerService'
import type { SmartPasteService } from '../../smart-paste/service'
import { ASK_AGENT_OPEN_SESSION } from '../ask-agent-contract'
import { t } from '../../../shared/i18n'
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { BrowserManager } from '../../browser/browserManager'
import { themeBackground } from './theme'

export function createMainWindow(getInboxURL: () => string | null = () => null, smartPaste?: { service: SmartPasteService; banner: BannerService; hasSession(id: string): boolean }): { window: BrowserWindow; browser: BrowserManager } {
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
  window.webContents.on('will-frame-navigate', event => { if (!event.isMainFrame) event.preventDefault() })

  const raiseBanner = smartPaste && mountBanner(window, smartPaste.banner, async (id, current) => {
    if (!smartPaste.hasSession(id) || !await browser.openAskSession(current) || window.isDestroyed() || !current() || !smartPaste.hasSession(id)) return false
    window.webContents.send(ASK_AGENT_OPEN_SESSION, id)
    return true
  })
  const browser: BrowserManager = new BrowserManager(window, getInboxURL, smartPaste?.service, raiseBanner)

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
