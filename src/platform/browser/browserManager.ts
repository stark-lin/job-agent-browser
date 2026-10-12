import { t, i18n } from '../../shared/i18n'
import { randomUUID } from 'node:crypto'
import { session, dialog, type BrowserWindow, type WebContents } from 'electron'
import { BROWSER_CHROME_HEIGHT, getSidebarWidth, BROWSER_FOCUS_ADDRESS, BROWSER_STATE_CHANGED,
  type BrowserState, type BrowserTabState, type Presentation } from '../../shared/browser'
import { isBrowserDestination } from '../../shared/navigation'
import { resolveDestination } from './navigationManager'
import { MixedHistory } from './mixedHistory'
import { SESSION_PARTITION, WebSegment } from './webSegment'
import { installShortcuts } from './shortcuts'

interface Tab { id: string; version: number; history: MixedHistory<WebSegment> }

export class BrowserManager {
  private readonly tabs = new Map<string, Tab>()
  private activeTabId = ''
  private revision = 0
  private visible = false
  private unsaved = false
  private confirming = false

  constructor(private readonly window: BrowserWindow, private readonly getInboxURL: () => string | null = () => null) {
    session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    void this.createTab()
    const languageChanged = () => { window.setTitle(t($ => $.app.title)); this.publishState() }
    i18n.on('languageChanged', languageChanged)
    window.on('close', event => {
      if (!this.unsaved) return
      event.preventDefault()
      void this.confirmLeave().then(allowed => { if (allowed && !window.isDestroyed()) window.close() })
    })
    window.webContents.on('will-prevent-unload', event => {
      if (dialog.showMessageBoxSync(window, this.leaveDialog()) === 1) { this.unsaved = false; event.preventDefault() }
    })
    this.shortcuts(window.webContents)
    window.webContents.on('did-start-loading', () => {
      // Invalidate acknowledgments from the previous renderer document as well
      // as hiding its views until the new React tree has committed.
      const tab = this.tabs.get(this.activeTabId)
      if (tab) this.transition(tab)
    })
    window.on('resize', () => this.layout())
    window.on('closed', () => {
      i18n.off('languageChanged', languageChanged)
      for (const tab of this.tabs.values()) tab.history.dispose()
      this.tabs.clear()
    })
  }

  setUnsaved(unsaved: boolean, presentation: Presentation): void {
    const tab = this.requireTab(this.activeTabId)
    const destination = this.tabState(tab).destination
    if (presentation.tabId === tab.id && presentation.targetId === this.targetId(tab) && destination.kind === 'internal' &&
      destination.page === 'settings') this.unsaved = unsaved
  }

  private leaveDialog(): Electron.MessageBoxOptions {
    return { type: 'question', title: t($ => $.settings.discardTitle), message: t($ => $.settings.discardDescription),
      buttons: [t($ => $.settings.stay), t($ => $.settings.discard)], defaultId: 0, cancelId: 0, noLink: true }
  }

  private async confirmLeave(): Promise<boolean> {
    if (this.confirming) return false
    this.confirming = true
    const revision = this.revision
    try {
      const result = await dialog.showMessageBox(this.window, this.leaveDialog())
      if (result.response !== 1 || this.window.isDestroyed() || revision !== this.revision) return false
      this.unsaved = false
      return true
    } finally { this.confirming = false }
  }

  isTrustedSender(senderId: number): boolean {
    return !this.window.isDestroyed() && this.window.webContents.id === senderId
  }

  layout(): void {
    const { width, height } = this.window.getContentBounds()
    const sidebar = getSidebarWidth(width)
    for (const tab of this.tabs.values()) for (const item of tab.history.items) {
      if (item.kind === 'web') {
        const inset = item.segment.surface === 'inbox' ? 0 : BROWSER_CHROME_HEIGHT
        item.segment.view.setBounds({ x: sidebar, y: inset, width: Math.max(0, width - sidebar), height: Math.max(0, height - inset) })
      }
    }
  }

  setVisible(visible: boolean, presentation: Presentation): void {
    const tab = this.requireTab(this.activeTabId)
    if (presentation.tabId !== tab.id || presentation.targetId !== this.targetId(tab)) return
    const destination = this.tabState(tab).destination
    this.visible = visible && (destination.kind === 'web' || isBrowserDestination(destination))
    this.updateVisibility()
  }

  async createTab(): Promise<void> {
    if (this.unsaved && !(await this.confirmLeave())) return
    const tab: Tab = { id: randomUUID(), version: 0, history: new MixedHistory() }
    tab.history.append({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'home' } })
    this.tabs.set(tab.id, tab)
    this.activeTabId = tab.id
    this.transition(tab)
  }

  async activateTab(id: string): Promise<void> {
    const tab = this.requireTab(id)
    if (this.activeTabId === id) return
    if (this.unsaved && !(await this.confirmLeave())) return
    this.activeTabId = id
    this.transition(tab)
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.requireTab(id), ids = [...this.tabs.keys()], index = ids.indexOf(id)
    if (this.activeTabId === id && this.unsaved && !(await this.confirmLeave())) return
    this.tabs.delete(id)
    tab.history.dispose()
    if (!this.tabs.size) { await this.createTab(); return }
    if (this.activeTabId === id) {
      this.activeTabId = ids[index + 1] ?? ids[index - 1]
      this.transition(this.requireTab(this.activeTabId))
    } else this.publishState()
  }

  async navigate(input: string, surface: 'browser' | 'inbox' = 'browser'): Promise<void> {
    let destination = resolveDestination(input) // Reject invalid input before mutating either history.
    if (destination.kind === 'internal' && destination.page === 'inbox') {
      const inboxURL = this.getInboxURL()
      if (inboxURL) { destination = resolveDestination(inboxURL); surface = 'inbox' }
    }
    if (this.unsaved && !(await this.confirmLeave())) return
    const tab = this.requireTab(this.activeTabId)
    if (destination.kind === 'internal') {
      tab.history.append({ kind: 'internal', id: randomUUID(), destination })
      this.transition(tab)
      return
    }
    tab.history.branch()
    let segment: WebSegment
    if (tab.history.current.kind === 'web' && tab.history.current.segment.surface === surface) segment = tab.history.current.segment
    else {
      segment = new WebSegment(this.window, (newEntry) => {
        if (!this.tabs.has(tab.id)) return
        if (newEntry && tab.history.current.kind === 'web' && tab.history.current.segment === segment) tab.history.discardFuture()
        this.updateVisibility(); this.publishState()
      }, (url) => {
        void (async () => {
          if (this.unsaved && !(await this.confirmLeave())) return
          await this.createTab(); await this.navigate(url, segment.surface)
        })().catch(() => { /* The popup's load error belongs to its own tab. */ })
      }, surface)
      this.shortcuts(segment.view.webContents)
      tab.history.append({ kind: 'web', id: segment.id, segment })
    }
    // Establish a web destination before publishing or asking React to present it.
    segment.url = destination.url
    this.transition(tab)
    await segment.navigate(destination.url)
  }

  back(): Promise<void> { return this.travel(-1) }
  forward(): Promise<void> { return this.travel(1) }

  getState(): BrowserState {
    return { language: i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en', revision: this.revision, tabs: [...this.tabs.values()].map((tab) => this.tabState(tab)), activeTabId: this.activeTabId }
  }

  private tabState(tab: Tab): BrowserTabState {
    const item = tab.history.current
    const destination = item.kind === 'internal' ? item.destination : { kind: 'web' as const, url: item.segment.url,
      ...(item.segment.surface === 'inbox' ? { surface: 'inbox' as const } : {}) }
    return {
      id: tab.id, destination, targetId: this.targetId(tab),
      title: item.kind === 'internal' ? t($ => $.navigation.pages[item.destination.page]) : item.segment.surface === 'inbox' ? t($ => $.navigation.pages.inbox) : item.segment.title,
      url: destination.kind === 'web' ? destination.url : '',
      canGoBack: tab.history.canGoBack, canGoForward: tab.history.canGoForward,
      isLoading: item.kind === 'web' && item.segment.isLoading,
      error: item.kind === 'web' ? item.segment.error : ''
    }
  }

  private targetId(tab: Tab): string { return `${tab.history.current.id}:${tab.version}` }
  private requireTab(id: string): Tab {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error(t($ => $.errors.tabUnavailable))
    return tab
  }

  private async travel(direction: -1 | 1): Promise<void> {
    const tab = this.requireTab(this.activeTabId)
    if (direction === -1 ? !tab.history.canGoBack : !tab.history.canGoForward) return
    if (this.unsaved && !(await this.confirmLeave())) return
    tab.history.travel(direction)
    this.transition(tab)
  }

  private transition(tab: Tab): void {
    this.unsaved = false
    tab.version++
    this.visible = false // The owning Browser or Inbox page acknowledges the committed target.
    this.updateVisibility(); this.publishState()
  }

  private updateVisibility(): void {
    for (const tab of this.tabs.values()) for (const item of tab.history.items) {
      if (item.kind === 'web') item.segment.view.setVisible(this.visible && tab.id === this.activeTabId && item === tab.history.current)
    }
    if (!this.window.isDestroyed()) this.layout()
  }

  private shortcuts(contents: WebContents): void {
    installShortcuts(contents, {
      back: () => this.back(), forward: () => this.forward(), createTab: () => this.createTab(),
      closeActive: () => this.closeTab(this.activeTabId),
      cycle: (direction) => {
        const ids = [...this.tabs.keys()], index = ids.indexOf(this.activeTabId)
        this.activateTab(ids[(index + direction + ids.length) % ids.length])
      },
      focusAddress: () => {
        if (!isBrowserDestination(this.tabState(this.requireTab(this.activeTabId)).destination)) return
        this.window.webContents.focus(); this.window.webContents.send(BROWSER_FOCUS_ADDRESS)
      }
    })
  }

  private publishState(): void {
    this.revision++
    if (!this.window.isDestroyed()) this.window.webContents.send(BROWSER_STATE_CHANGED, this.getState())
  }
}
