import { randomUUID } from 'node:crypto'
import { session, WebContentsView, type BrowserWindow } from 'electron'
import type { HistorySegment } from './mixedHistory'
import { NativeHistoryIdentity } from './nativeHistory'

export const SESSION_PARTITION = 'persist:job-agent-browser'
const LOAD_ERROR = 'Unable to load this page. Check the address and your connection.'

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

  constructor(
    private readonly window: BrowserWindow,
    private readonly changed: (newEntry: boolean) => void,
    openPopup: (url: string) => void
  ) {
    this.view = new WebContentsView({ webPreferences: {
      session: session.fromPartition(SESSION_PARTITION), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true
    } })
    this.view.setVisible(false)
    window.contentView.addChildView(this.view)
    const contents = this.view.webContents
    this.identity = new NativeHistoryIdentity(contents)
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
        this.isLoading = false; this.error = LOAD_ERROR; this.pendingIndex = undefined; this.notify()
      }
    })
  }

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
      this.isLoading = false; this.error = LOAD_ERROR; this.notify()
      throw new Error(LOAD_ERROR)
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
      this.error = 'Unable to synchronize browser history.'
      this.notify()
    })
  }

  private notify(newEntry = false): void { if (!this.disposed) this.changed(newEntry) }
}
