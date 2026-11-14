import { WebContentsView, type BrowserWindow } from 'electron'
import type { SidebarTooltip } from '../../shared/browser'
import { navigationTooltipStyles } from '../../shared/ui/navigation-tooltip-styles'

// Native web content is above the renderer's top layer. Mirror the label in a
// small sibling view so the tooltip can stay above the active web surface.
export function mountNavigationTooltip(window: BrowserWindow) {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const contents = view.webContents
  let revision = 0
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  window.contentView.addChildView(view)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-frame-navigate', event => event.preventDefault())
  const loaded = contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Navigation tooltip</title><style>${navigationTooltipStyles}
html, body { margin: 0; overflow: hidden; background: transparent; }
body { box-sizing: border-box; }
</style><body class="ui-navigation-tooltip" aria-hidden="true"></body>`)}`).then(() => true, () => false)
  const hide = () => {
    revision++
    view.setVisible(false)
  }
  // The tip is display-only. If a pointer jumps directly into its bounds,
  // remove the native view so subsequent input reaches the underlying page.
  contents.on('before-mouse-event', hide)
  window.on('blur', hide)
  window.on('resize', hide)
  window.once('closed', () => { if (!contents.isDestroyed()) contents.close() })
  return async (tooltip: SidebarTooltip | null) => {
    hide()
    if (!tooltip) return
    const current = revision
    const { width, height } = window.getContentBounds()
    const x = Math.floor(tooltip.x), y = Math.floor(tooltip.y)
    const tipWidth = Math.ceil(tooltip.width), tipHeight = Math.ceil(tooltip.height)
    if (x < 0 || y < 0 || tipWidth < 1 || tipHeight < 1 || x + tipWidth > width || y + tipHeight > height) return
    if (!await loaded || current !== revision || contents.isDestroyed()) return
    try {
      await contents.executeJavaScript(`document.body.textContent = ${JSON.stringify(tooltip.label)}`)
      if (current !== revision || contents.isDestroyed()) return
      view.setBounds({ x, y, width: tipWidth, height: tipHeight })
      window.contentView.addChildView(view)
      view.setVisible(true)
    } catch { /* The window may have closed while updating the label. */ }
  }
}
