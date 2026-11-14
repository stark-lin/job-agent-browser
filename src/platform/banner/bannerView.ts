import { join } from 'node:path'
import { nativeTheme, WebContentsView, type BrowserWindow } from 'electron'
import { t, i18n } from '../../shared/i18n'
import { BANNER_INTERACTION, BANNER_STATE, type BannerEvent } from '../../shared/banner'
import { bannerDocument } from '../../shared/ui'
import { BANNER_HEIGHT, BANNER_INSET, BANNER_WIDTH } from '../../shared/ui/geometry'
import { resolvedTheme } from '../electron/main/theme'
import type { BannerService } from './bannerService'

export function mountBanner(window: BrowserWindow, service: BannerService, openSession: (id: string, current: () => boolean) => Promise<boolean>) {
  const view = new WebContentsView({ webPreferences: {
    preload: join(__dirname, '../preload/banner.js'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } })
  const contents = view.webContents
  let current: BannerEvent | null = null
  let loaded = false
  let disposed = false
  let opening: string | undefined
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  window.contentView.addChildView(view)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-frame-navigate', event => event.preventDefault())
  const layout = () => {
    const { width, height } = window.getContentBounds()
    const bannerWidth = Math.min(BANNER_WIDTH, Math.max(0, width - BANNER_INSET * 2))
    view.setBounds({ x: Math.max(0, width - bannerWidth - BANNER_INSET), y: Math.max(0, height - BANNER_HEIGHT - BANNER_INSET), width: bannerWidth, height: BANNER_HEIGHT })
  }
  const update = () => {
    if (disposed || !loaded || contents.isDestroyed()) return
    try {
      contents.send(BANNER_STATE, { event: current, theme: resolvedTheme(), closeLabel: t($ => $.smartPaste.closeBanner) })
      view.setVisible(Boolean(current))
    } catch { view.setVisible(false) }
  }
  const detach = service.attach(event => { current = event; update() })
  contents.ipc.on(BANNER_INTERACTION, (event, method: unknown, time: unknown) => {
    if (disposed || event.senderFrame !== contents.mainFrame || typeof time !== 'string') return
    if (method === 'dismiss') service.dismiss(time)
    const action = method === 'open' ? service.action(time) : undefined
    if (!action || opening) return
    opening = time
    void openSession(action.sessionId, () => service.action(time) === action).then(opened => {
      if (opened) service.dismiss(time)
    }).catch(() => {}).finally(() => { opening = undefined })
  })
  layout()
  window.on('resize', layout)
  nativeTheme.on('updated', update)
  i18n.on('languageChanged', update)
  void contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bannerDocument())}`).then(() => {
    loaded = true
    update()
  }).catch(() => {})
  window.once('closed', () => {
    disposed = true
    detach()
    window.off('resize', layout)
    nativeTheme.off('updated', update)
    i18n.off('languageChanged', update)
    if (!contents.isDestroyed()) contents.close()
  })
  return () => {
    if (!disposed) window.contentView.addChildView(view)
  }
}
