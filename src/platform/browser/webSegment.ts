import { t } from '../../shared/i18n'
import { randomUUID } from 'node:crypto'
import { dialog, Menu, session, WebContentsView, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { selectionContent, type SelectionTarget, type WebSelection } from '../../shared/browser-selection'
import { themeBackground } from '../electron/main/theme'
import type { HistorySegment } from './mixedHistory'
import { NativeHistoryIdentity } from './nativeHistory'

export const SESSION_PARTITION = 'persist:job-agent-browser'

export function isWebURL(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export class WebSegment implements HistorySegment {
  readonly id = randomUUID()
  readonly view: WebContentsView
  url = ''
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
    private readonly selection?: { identity(): string | null; accept(target: SelectionTarget, content: Pick<WebSelection, 'text' | 'source'>): void }
  ) {
    this.view = new WebContentsView({ webPreferences: {
      session: session.fromPartition(SESSION_PARTITION), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true
    } })
    this.updateThemeBackground()
    this.view.setVisible(false)
    window.contentView.addChildView(this.view)
    const contents = this.view.webContents
    this.identity = new NativeHistoryIdentity(contents)
    contents.on('did-start-navigation', () => { this.navigationGeneration++ })
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
    contents.on('did-stop-loading', () => { this.isLoading = false; this.notify() })
    contents.on('did-navigate', () => this.committed())
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) this.committed() })
    contents.on('page-title-updated', () => this.notify())
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) {
        this.isLoading = false; this.error = t($ => $.errors.loadFailed); this.pendingIndex = undefined; this.notify()
      }
    })
  }

  updateThemeBackground(): void { if (!this.disposed) this.view.setBackgroundColor(themeBackground()) }

  get title(): string { return this.view.webContents.getTitle() || this.url }
  get length(): number { return Math.max(1, this.view.webContents.navigationHistory.length()) }
  get index(): number { return this.pendingIndex ?? Math.max(0, this.view.webContents.navigationHistory.getActiveIndex()) }

  async navigate(url: string): Promise<void> {
    const generation = ++this.generation
    this.pendingIndex = undefined
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
    this.pendingIndex = index
    this.view.webContents.navigationHistory.goToIndex(index)
  }

  trimForward(): void {
    const history = this.view.webContents.navigationHistory
    for (let index = history.length() - 1; index > this.index; index--) history.removeEntryAtIndex(index)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.window.isDestroyed()) this.menu?.closePopup(this.window)
    this.menu = undefined
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view)
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
    if (this.disposed || this.window.isDestroyed()) return
    const contents = this.view.webContents, frame = params.frame
    if (!frame || frame.detached) return
    const generation = this.navigationGeneration, identity = this.selection?.identity()
    const current = () => !this.disposed && !this.window.isDestroyed() && !contents.isDestroyed() && !frame.detached &&
      generation === this.navigationGeneration && identity != null && identity === this.selection?.identity()
    const template: MenuItemConstructorOptions[] = []
    const flags = params.editFlags
    if (params.isEditable) template.push({ role: 'undo', enabled: flags.canUndo }, { role: 'redo', enabled: flags.canRedo }, { type: 'separator' }, { role: 'cut', enabled: flags.canCut })
    template.push({ role: 'copy', enabled: flags.canCopy })
    if (params.isEditable) template.push({ role: 'paste', enabled: flags.canPaste })
    template.push({ role: 'selectAll', enabled: flags.canSelectAll })
    if (this.surface === 'browser' && !params.isEditable && params.formControlType === 'none' && params.selectionText.trim() && identity != null) {
      const text = params.selectionText, url = contents.getURL(), title = contents.getTitle()
      const accept = (target: SelectionTarget) => {
        if (!current()) return
        let content: Pick<WebSelection, 'text' | 'source'>
        try { content = selectionContent(text, url, title) } catch {
          void dialog.showMessageBox(this.window, { type: 'warning', message: t($ => $.selection.invalid), buttons: [t($ => $.selection.ok)] })
          return
        }
        this.selection?.accept(target, content)
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
