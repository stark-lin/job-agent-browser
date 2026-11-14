import { join } from 'node:path'
import { WebContentsView, type View, type MouseInputEvent } from 'electron'
import { t } from '../../shared/i18n'
import { historyIndicatorDocument } from '../../shared/ui'
import { HISTORY_INDICATOR_SIZE, HISTORY_INDICATOR_INSET } from '../../shared/ui/geometry'
import { resolvedTheme } from '../electron/main/theme'
import type { HistoryFeedback } from './historyDrag'

/** A trusted, scriptless overlay; the website cannot restyle or remove it. */
export class HistoryIndicator {
  readonly view = new WebContentsView({ webPreferences: {
    preload: join(__dirname, '../preload/browser-gestures.js'), nodeIntegration: false, contextIsolation: true, sandbox: true
  } })
  private feedback: HistoryFeedback | null = null
  private loaded = false
  private disposed = false
  private revision = 0

  constructor(private readonly surface: View, mouse: (event: Electron.Event, input: MouseInputEvent) => void) {
    this.view.setBackgroundColor('#00000000')
    this.view.setVisible(false)
    surface.addChildView(this.view)
    const contents = this.view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    contents.on('before-mouse-event', (event, input) => {
      const { x, y } = this.view.getBounds()
      mouse(event, { ...input, x: input.x + x, y: input.y + y })
    })
    void contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(historyIndicatorDocument())}`).then(() => {
      this.loaded = true
      this.draw(this.feedback)
    }).catch(() => { /* Navigation remains available if the decorative overlay fails. */ })
  }

  draw(feedback: HistoryFeedback | null): void {
    this.feedback = feedback
    const revision = ++this.revision
    if (this.disposed) return
    if (!feedback) { this.view.setVisible(false); return }
    this.layout()
    if (!this.loaded) return
    const state = { direction: feedback.direction === -1 ? 'back' : 'forward', available: String(feedback.available), ready: String(feedback.ready), theme: resolvedTheme() }
    const label = feedback.direction === -1 ? t($ => $.browser.back) : t($ => $.browser.forward)
    void this.view.webContents.executeJavaScript(`Object.assign(document.documentElement.dataset, ${JSON.stringify(state)}); document.querySelector('[role="img"]').setAttribute('aria-label', ${JSON.stringify(label)})`).then(() => {
      if (!this.disposed && revision === this.revision) this.view.setVisible(true)
    }).catch(() => {})
  }

  private layout(): void {
    if (!this.feedback || this.disposed) return
    const { width, height } = this.surface.getBounds(), size = Math.min(HISTORY_INDICATOR_SIZE, width, height)
    const inset = Math.min(HISTORY_INDICATOR_INSET, Math.max(0, (width - size) / 2))
    this.view.setBounds({ x: Math.round(this.feedback.direction === -1 ? inset : width - size - inset), y: Math.round((height - size) / 2), width: size, height: size })
  }

  updateTheme(): void { this.draw(this.feedback) }

  dispose(): void {
    this.disposed = true
    this.revision++
    this.surface.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}
