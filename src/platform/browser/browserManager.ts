import { flushKnowledge } from '../electron/main/knowledge-flush'
import { t, i18n } from '../../shared/i18n'
import { randomUUID } from 'node:crypto'
import { app, session, dialog, nativeTheme, type BrowserWindow, type WebContents } from 'electron'
import { resolvedTheme, themeBackground } from '../electron/main/theme'
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
  private rendererLoading = false

  constructor(private readonly window: BrowserWindow, private readonly getInboxURL: () => string | null = () => null) {
    session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    void this.createTab()
    const languageChanged = () => { window.setTitle(t($ => $.app.title)); this.publishState() }
    i18n.on('languageChanged', languageChanged)
    const themeChanged = () => {
      if (window.isDestroyed()) return
      window.setBackgroundColor(themeBackground())
      for (const tab of this.tabs.values()) for (const item of tab.history.items) {
        if (item.kind === 'web') item.segment.updateThemeBackground()
      }
      this.publishState()
    }
    nativeTheme.on('updated', themeChanged)
    let knowledgeClosing = false, quitRequested = false
    const beforeQuit = () => { quitRequested = true }
    app.on('before-quit', beforeQuit)
    window.on('close', event => {
      if (knowledgeClosing || !this.unsaved && !this.isKnowledge()) return
      event.preventDefault()
      void this.confirmLeave().then(allowed => { if (allowed && !window.isDestroyed()) { knowledgeClosing = true; if (quitRequested) app.quit(); else window.close() } else quitRequested = false })
    })
    window.webContents.on('will-prevent-unload', event => {
      if (!this.unsaved || dialog.showMessageBoxSync(window, this.leaveDialog()) === 1) { this.unsaved = false; event.preventDefault() }
    })
    this.shortcuts(window.webContents)
    window.webContents.on('did-start-loading', () => {
      // Keep the current React draft/target until beforeunload permits a commit.
      this.rendererLoading = true; this.updateVisibility()
    })
    window.webContents.on('did-navigate', () => {
      const tab = this.tabs.get(this.activeTabId)
      if (tab) this.transition(tab)
    })
    window.webContents.on('did-stop-loading', () => { this.rendererLoading = false; this.updateVisibility() })
    window.on('resize', () => this.layout())
    window.on('closed', () => {
      app.removeListener('before-quit', beforeQuit)
      i18n.off('languageChanged', languageChanged)
      nativeTheme.off('updated', themeChanged)
      for (const tab of this.tabs.values()) tab.history.dispose()
      this.tabs.clear()
    })
  }

  setUnsaved(unsaved: boolean, presentation: Presentation): void {
    const tab = this.requireTab(this.activeTabId)
    const destination = this.tabState(tab).destination
    if (presentation.tabId === tab.id && presentation.targetId === this.targetId(tab) && destination.kind === 'internal' &&
      (destination.page === 'settings' || destination.page === 'profile' || destination.page === 'find' || destination.page === 'knowledge')) this.unsaved = unsaved
  }

  private isKnowledge(): boolean {
    const tab = this.tabs.get(this.activeTabId)
    const destination = tab && this.tabState(tab).destination
    return destination?.kind === 'internal' && destination.page === 'knowledge'
  }

  private leaveDialog(): Electron.MessageBoxOptions {
    const destination = this.tabState(this.requireTab(this.activeTabId)).destination
    const profile = destination.kind === 'internal' && destination.page === 'profile'
    const job = destination.kind === 'internal' && destination.page === 'find'
    return { type: 'question', title: profile ? t($ => $.profile.discardTitle) : job ? t($ => $.jobs.discardTitle) : t($ => $.settings.discardTitle), message: profile ? t($ => $.profile.discardDescription) : job ? t($ => $.jobs.discardDescription) : t($ => $.settings.discardDescription),
      buttons: [t($ => $.settings.stay), t($ => $.settings.discard)], defaultId: 0, cancelId: 0, noLink: true }
  }

  private async confirmLeave(): Promise<boolean> {
    if (this.confirming) return false
    this.confirming = true
    const tab = this.requireTab(this.activeTabId), targetId = this.targetId(tab)
    try {
      if (this.isKnowledge()) {
        const saved = await flushKnowledge(this.window)
        if (!saved || this.window.isDestroyed() || this.activeTabId !== tab.id || targetId !== this.targetId(tab)) return false
        this.unsaved = false; return true
      }
      const result = await dialog.showMessageBox(this.window, this.leaveDialog())
      // Theme/other background snapshots must not invalidate an otherwise current confirmation.
      if (result.response !== 1 || this.window.isDestroyed() || this.activeTabId !== tab.id ||
        !this.tabs.has(tab.id) || targetId !== this.targetId(tab)) return false
      this.unsaved = false
      return true
    } finally { this.confirming = false }
  }

  isTrustedSender(senderId: number): boolean {
    return !this.window.isDestroyed() && this.window.webContents.id === senderId
  }

  layout(): void {
    const { width, height } = this.window.getContentBounds()
    const sidebar = getSidebarWidth()
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
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    const tab: Tab = { id: randomUUID(), version: 0, history: new MixedHistory() }
    tab.history.append({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'home' } })
    this.tabs.set(tab.id, tab)
    this.activeTabId = tab.id
    this.transition(tab)
  }

  async activateTab(id: string): Promise<void> {
    const tab = this.requireTab(id)
    if (this.activeTabId === id) return
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    this.activeTabId = id
    this.transition(tab)
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.requireTab(id), ids = [...this.tabs.keys()], index = ids.indexOf(id)
    if (this.activeTabId === id && (this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
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
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
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
          if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
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
    return { language: i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en', theme: resolvedTheme(), revision: this.revision, tabs: [...this.tabs.values()].map((tab) => this.tabState(tab)), activeTabId: this.activeTabId }
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
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
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
      if (item.kind === 'web') item.segment.view.setVisible(!this.rendererLoading && this.visible && tab.id === this.activeTabId && item === tab.history.current)
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
