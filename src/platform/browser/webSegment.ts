import { join } from 'node:path'
import { t } from '../../shared/i18n'
import { randomUUID } from 'node:crypto'
import { clipboard, dialog, Menu, session, View, WebContentsView, type BrowserWindow, type ContextMenuParams, type MouseInputEvent, type Rectangle, type MenuItemConstructorOptions } from 'electron'
import { selectionContent, type SelectionTarget, type WebSelection } from '../../shared/browser-selection'
import { themeBackground, browserTransitionBackground, browserCanvasBackground } from '../electron/main/theme'
import type { HistorySegment } from './tabNavigation'
import { installHistoryWheel } from './historyGesture'
import { HistoryPresentation } from './historyPresentation'
import { HistoryDrag } from './historyDrag'
import { HistoryIndicator } from './historyIndicator'
import { NativeHistoryIdentity } from './nativeHistory'

export const SESSION_PARTITION = 'persist:job-agent-browser'

const COPY_WEBPAGE_TEXT = String.raw`(() => {
  const html = document.documentElement.outerHTML;
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  if (!body) return '';

  body.querySelectorAll('script, style, noscript, template, svg, canvas, iframe').forEach(node => node.remove());
  // Collapse source formatting before adding line breaks for HTML structure.
  const texts = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    if (!node.parentElement?.closest('pre, textarea')) node.data = node.data.replace(/[\t\n\f\r ]+/g, ' ');
  }
  body.querySelectorAll('br, hr').forEach(node => node.replaceWith('\n'));
  body.querySelectorAll('address, article, aside, blockquote, caption, dd, details, dialog, div, dl, dt, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, li, main, menu, nav, ol, p, pre, section, summary, table, tr, ul').forEach(node => {
    node.before('\n');
    node.after('\n');
  });
  body.querySelectorAll('td, th').forEach(node => node.after(' '));

  return body.textContent.replace(/\u00a0/g, ' ').split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
})()`

export function isWebURL(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export class WebSegment implements HistorySegment {
  readonly id = randomUUID()
  readonly view: WebContentsView
  readonly surfaceView = new View()
  private readonly drag: HistoryDrag
  private readonly indicator?: HistoryIndicator
  private readonly cover = new View()
  private readonly presentation: HistoryPresentation
  private restoreThrottling: boolean | undefined
  private syncWheel: () => void = () => {}
  private resumeFocus = false
  private pendingContext?: ContextMenuParams
  url = ''
  entryURL = ''
  isLoading = false
  error = ''
  private disposed = false
  private generation = 0
  private pendingIndex: number | undefined
  private readonly identity: NativeHistoryIdentity
  private navigationGeneration = 0
  private menu?: Menu

  constructor(
    private readonly window: BrowserWindow,
    private readonly changed: (newEntry: boolean) => void,
    openPopup: (url: string) => void,
    readonly surface: 'browser' | 'inbox' = 'browser',
    private readonly browserActions?: {
      identity(): string | null
      accept(target: SelectionTarget, content: Pick<WebSelection, 'text' | 'source'>): void
      travel(direction: -1 | 1): void
      requestCopy(): void
    }
  ) {
    this.view = new WebContentsView({ webPreferences: {
      session: session.fromPartition(SESSION_PARTITION), nodeIntegration: false,
      preload: surface === 'browser' ? join(__dirname, '../preload/browser-gestures.js') : undefined,
      contextIsolation: true, sandbox: true, webSecurity: true
    } })
    this.surfaceView.addChildView(this.view)
    this.surfaceView.addChildView(this.cover)
    this.cover.setVisible(false)
    this.presentation = new HistoryPresentation(visible => {
      if (this.disposed) return
      if (visible && this.restoreThrottling === undefined) {
        this.restoreThrottling = this.view.webContents.getBackgroundThrottling()
        this.view.webContents.setBackgroundThrottling(false)
      }
      this.cover.setVisible(visible)
      if (!visible) {
        if (this.restoreThrottling !== undefined) this.view.webContents.setBackgroundThrottling(this.restoreThrottling)
        this.restoreThrottling = undefined
        this.restoreFocus()
      }
    }, async () => {
      const contents = this.view.webContents
      await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))' }])
      await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    })
    this.drag = new HistoryDrag({
      identity: () => this.surface === 'browser' && !this.disposed ? this.browserActions?.identity() ?? null : null,
      canTravel: direction => direction === -1 ? this.index > 0 : this.index < this.length - 1,
      width: () => this.surfaceView.getBounds().width,
      draw: feedback => this.indicator?.draw(feedback),
      travel: direction => { this.resumeFocus = true; this.browserActions?.travel(direction) },
      click: () => { const context = this.pendingContext; this.pendingContext = undefined; if (context) this.showContextMenu(context) },
      dismiss: () => { this.pendingContext = undefined }
    })
    if (surface === 'browser') this.indicator = new HistoryIndicator(this.surfaceView, (event, mouse) => {
      if (this.drag.handle(mouse)) event.preventDefault()
    })
    this.updateThemeBackground()
    this.setVisible(false)
    window.contentView.addChildView(this.surfaceView)
    const contents = this.view.webContents
    this.identity = new NativeHistoryIdentity(contents)
    if (surface === 'browser') {
      const active = () => !!this.browserActions?.identity(), epoch = () => this.navigationGeneration
      const sync = installHistoryWheel(contents, this.drag, active, epoch)
      const syncIndicator = installHistoryWheel(this.indicator!.view.webContents, this.drag, active, epoch)
      this.syncWheel = () => { sync(); syncIndicator() }
    }
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { this.navigationGeneration++; this.drag.cancel(); if (this.presentation.pending) this.presentation.begin() } })
    contents.on('before-mouse-event', (event, mouse) => this.handleMouse(event, mouse))
    contents.on('blur', () => this.drag.cancel())
    contents.on('context-menu', (_event, params) => this.contextMenu(params))
    contents.setWindowOpenHandler(({ url }) => {
      if (!this.disposed && isWebURL(url)) openPopup(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => { if (!isWebURL(url)) event.preventDefault() })
    contents.on('will-redirect', (event, url) => { if (!isWebURL(url)) event.preventDefault() })
    contents.on('did-start-loading', () => {
      this.isLoading = true; this.error = ''; this.notify()
    })
    contents.on('did-stop-loading', () => { this.isLoading = false; this.notify(); void this.presentation.ready() })
    contents.on('did-navigate', () => this.committed())
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) { this.committed(); if (!contents.isLoadingMainFrame()) void this.presentation.ready() } })
    contents.on('page-title-updated', () => this.notify())
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) {
        this.isLoading = false; this.error = t($ => $.errors.loadFailed); this.pendingIndex = undefined; this.notify()
      }
    })
  }

  updateThemeBackground(): void {
    if (this.disposed) return
    this.view.setBackgroundColor(this.surface === 'browser' ? browserCanvasBackground() : themeBackground())
    this.surfaceView.setBackgroundColor(browserCanvasBackground()); this.cover.setBackgroundColor(browserTransitionBackground())
    this.indicator?.updateTheme()
  }

  layout(bounds: Rectangle): void {
    const previous = this.surfaceView.getBounds()
    if (Object.keys(bounds).some(key => bounds[key as keyof Rectangle] !== previous[key as keyof Rectangle])) this.drag.cancel()
    this.surfaceView.setBounds(bounds)
    this.cover.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    this.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }

  setVisible(visible: boolean): void {
    if (!visible) this.drag.cancel()
    this.surfaceView.setVisible(visible); this.view.setVisible(visible)
    this.syncWheel()
    if (visible) this.restoreFocus()
  }

  private restoreFocus(): void {
    if (this.resumeFocus && !this.presentation.pending && this.surfaceView.getVisible()) {
      this.resumeFocus = false; this.view.webContents.focus()
    }
  }

  handleMouse(event: Electron.Event, mouse: MouseInputEvent, fromRenderer = false): void {
    if (this.disposed || fromRenderer && !this.drag.tracking) return
    const origin = fromRenderer ? this.surfaceView.getBounds() : this.view.getBounds()
    const input = { ...mouse, x: mouse.x + (fromRenderer ? -origin.x : origin.x), y: mouse.y + (fromRenderer ? -origin.y : origin.y) }
    if (this.drag.handle(input)) event.preventDefault()
  }

  cancelDrag(): void { this.drag.cancel() }

  get title(): string { return this.view.webContents.getTitle() || this.url }
  get length(): number { return Math.max(1, this.view.webContents.navigationHistory.length()) }
  get index(): number { return this.pendingIndex ?? Math.max(0, this.view.webContents.navigationHistory.getActiveIndex()) }

  async navigate(url: string): Promise<void> {
    const generation = ++this.generation
    this.pendingIndex = undefined
    this.entryURL = url
    this.url = url; this.error = ''; this.isLoading = true; this.notify()
    try {
      await this.view.webContents.loadURL(url)
    } catch (reason) {
      const aborted = reason instanceof Error && 'code' in reason && reason.code === 'ERR_ABORTED'
      if (this.disposed || generation !== this.generation || aborted) return
      this.isLoading = false; this.error = t($ => $.errors.loadFailed); this.notify()
      throw new Error(t($ => $.errors.loadFailed))
    }
  }

  move(index: number): void {
    if (index === this.index || this.view.webContents.navigationHistory.length() === 0) return
    if (this.surface === 'browser') this.presentation.begin()
    this.pendingIndex = index
    this.view.webContents.navigationHistory.goToIndex(index)
  }

  reload(): void {
    if (this.disposed || !this.url || this.isLoading) return
    this.drag.cancel()
    this.presentation.begin()
    this.view.webContents.reload()
  }

  private canCopyWebpage(): boolean {
    const contents = this.view.webContents
    return this.surface === 'browser' && !this.disposed && !contents.isDestroyed() && !contents.isCrashed() &&
      !this.isLoading && !this.error && this.pendingIndex === undefined && !contents.isLoadingMainFrame() &&
      isWebURL(this.url) && contents.getURL() === this.url
  }

  async copyWebpage(isCurrent: () => boolean): Promise<void> {
    const contents = this.view.webContents, generation = this.navigationGeneration
    try {
      if (!this.canCopyWebpage() || !isCurrent()) throw new Error()
      const text: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: COPY_WEBPAGE_TEXT }])
      if (typeof text !== 'string' || !text || generation !== this.navigationGeneration ||
        !this.canCopyWebpage() || !isCurrent()) throw new Error()
      await clipboard.writeText(text)
    } catch {
      throw new Error(t($ => $.browser.copyFailed))
    }
  }

  trimForward(): void {
    const history = this.view.webContents.navigationHistory
    for (let index = history.length() - 1; index > this.index; index--) history.removeEntryAtIndex(index)
  }

  dispose(): void {
    if (this.disposed) return
    this.drag.cancel()
    this.presentation.dispose()
    this.indicator?.dispose()
    this.disposed = true
    if (!this.window.isDestroyed()) this.menu?.closePopup(this.window)
    this.menu = undefined
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.surfaceView)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private committed(): void {
    if (this.disposed) return
    this.pendingIndex = undefined
    this.url = this.view.webContents.getURL()
    this.error = ''
    // Do not publish a partially classified entry: callers may immediately
    // traverse again or leave Browser as soon as they receive the snapshot.
    void this.identity.committed().then((newEntry) => this.notify(newEntry)).catch(() => {
      if (this.disposed) return
      this.error = t($ => $.errors.historySyncFailed)
      this.notify()
    })
  }

  private notify(newEntry = false): void { if (!this.disposed) this.changed(newEntry) }

  private contextMenu(params: ContextMenuParams): void {
    if (this.drag.blocksMenu) return
    if (this.drag.tracking) { this.pendingContext = params; return }
    this.showContextMenu(params)
  }

  private showContextMenu(params: ContextMenuParams): void {
    if (this.disposed || this.window.isDestroyed()) return
    const contents = this.view.webContents, frame = params.frame
    if (!frame || frame.detached) return
    const generation = this.navigationGeneration, identity = this.browserActions?.identity()
    const current = () => !this.disposed && !this.window.isDestroyed() && !contents.isDestroyed() && !frame.detached &&
      generation === this.navigationGeneration && identity != null && identity === this.browserActions?.identity()
    const template: MenuItemConstructorOptions[] = []
    const flags = params.editFlags
    if (params.isEditable) template.push({ role: 'undo', enabled: flags.canUndo }, { role: 'redo', enabled: flags.canRedo }, { type: 'separator' }, { role: 'cut', enabled: flags.canCut })
    template.push({ role: 'copy', enabled: flags.canCopy })
    if (params.isEditable) template.push({ role: 'paste', enabled: flags.canPaste })
    template.push({ role: 'selectAll', enabled: flags.canSelectAll }, { type: 'separator' },
      { id: 'browser-refresh', label: t($ => $.browser.refresh), enabled: !this.isLoading, click: () => {
        if (!this.disposed && this.surfaceView.getVisible() && generation === this.navigationGeneration) this.reload()
      } })
    if (this.surface === 'browser') {
      template.push({ id: 'browser-copy-webpage', label: t($ => $.browser.copyWebpage),
        enabled: identity != null && this.canCopyWebpage(), click: () => this.browserActions?.requestCopy() })
    }
    if (this.surface === 'browser' && !params.isEditable && params.formControlType === 'none' && params.selectionText.trim() && identity != null) {
      const text = params.selectionText, url = contents.getURL(), title = contents.getTitle()
      const accept = (target: SelectionTarget) => {
        if (!current()) return
        let content: Pick<WebSelection, 'text' | 'source'>
        try { content = selectionContent(text, url, title) } catch {
          void dialog.showMessageBox(this.window, { type: 'warning', message: t($ => $.selection.invalid), buttons: [t($ => $.selection.ok)] })
          return
        }
        this.browserActions?.accept(target, content)
      }
      template.push({ type: 'separator' }, { id: 'selection-ask-ai', label: t($ => $.selection.ask), click: () => accept('ask-ai') },
        { id: 'selection-job-import', label: t($ => $.selection.job), click: () => accept('job-import') })
    }
    this.menu?.closePopup(this.window)
    const menu = Menu.buildFromTemplate(template)
    this.menu = menu
    contents.focus()
    menu.popup({ window: this.window, frame, sourceType: params.menuSourceType, callback: () => { if (this.menu === menu) this.menu = undefined } })
  }
}
