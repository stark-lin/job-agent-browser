import type { SmartPasteService } from '../smart-paste/service'
import { flushKnowledge } from '../electron/main/knowledge-flush'
import { t, i18n } from '../../shared/i18n'
import { randomUUID } from 'node:crypto'
import { app, session, dialog, nativeTheme, type BrowserWindow, type WebContents } from 'electron'
import { resolvedTheme, themeBackground } from '../electron/main/theme'
import { BROWSER_CHROME_HEIGHT, getSidebarWidth, BROWSER_COPY_WEBPAGE_RESULT, BROWSER_FOCUS_ADDRESS, BROWSER_STATE_CHANGED,
  type BrowserState, type BrowserTabState, type Presentation, type SidebarTooltip } from '../../shared/browser'
import { isBrowserDestination } from '../../shared/navigation'
import { resolveDestination } from './navigationManager'
import { TabNavigation } from './tabNavigation'
import { SESSION_PARTITION, WebSegment } from './webSegment'
import { installShortcuts } from './shortcuts'
import { SelectionHandoff } from './selectionHandoff'
import type { SelectionTarget, WebSelection } from '../../shared/browser-selection'
import { mountNavigationTooltip } from './navigationTooltip'

interface Tab { id: string; version: number; history: TabNavigation<WebSegment> }

export class BrowserManager {
  private readonly tabs = new Map<string, Tab>()
  private activeTabId = ''
  private revision = 0
  private visible = false
  private unsaved = false
  private confirming = false
  private rendererLoading = false
  private readonly selections = new SelectionHandoff()
  private readonly showSidebarTooltip: ReturnType<typeof mountNavigationTooltip>

  constructor(private readonly window: BrowserWindow, private readonly getInboxURL: () => string | null = () => null,
    private readonly smartPaste?: SmartPasteService, private readonly raiseBanner?: () => void) {
    this.showSidebarTooltip = mountNavigationTooltip(window)
    session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.addTab('ai')
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
    window.webContents.on('before-mouse-event', (event, mouse) => {
      const item = this.tabs.get(this.activeTabId)?.history.current
      if (item?.kind === 'web') item.segment.handleMouse(event, mouse, true)
    })
    window.on('blur', () => { for (const tab of this.tabs.values()) for (const item of tab.history.items) item.segment.cancelDrag() })
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
      this.selections.dispose()
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

  private async confirmLeave(isCurrent: () => boolean = () => true): Promise<boolean> {
    if (this.confirming) return false
    this.confirming = true
    const tab = this.requireTab(this.activeTabId), targetId = this.targetId(tab)
    try {
      if (this.isKnowledge()) {
        const saved = await flushKnowledge(this.window)
        if (!saved || !isCurrent() || this.window.isDestroyed() || this.activeTabId !== tab.id || targetId !== this.targetId(tab)) return false
        this.unsaved = false; return true
      }
      const result = await dialog.showMessageBox(this.window, this.leaveDialog())
      // Theme/other background snapshots must not invalidate an otherwise current confirmation.
      if (result.response !== 1 || !isCurrent() || this.window.isDestroyed() || this.activeTabId !== tab.id ||
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
        item.segment.layout({ x: sidebar, y: inset, width: Math.max(0, width - sidebar), height: Math.max(0, height - inset) })
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

  setSidebarTooltip(tooltip: SidebarTooltip | null): Promise<void> {
    const item = this.tabs.get(this.activeTabId)?.history.current
    return this.showSidebarTooltip(!this.rendererLoading && this.visible && item?.kind === 'web' ? tooltip : null)
  }

  async createTab(): Promise<void> {
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    this.addTab('browser')
  }

  private addTab(page: 'ai' | 'browser'): void {
    const tab: Tab = { id: randomUUID(), version: 0, history: new TabNavigation({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page } }) }
    this.tabs.set(tab.id, tab)
    this.activeTabId = tab.id
    this.transition(tab)
  }

  async activateTab(id: string): Promise<void> {
    const tab = this.requireTab(id)
    if (this.activeTabId === id) return
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    if (this.isBrowser()) tab.history.showPage({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'browser' } })
    this.activeTabId = id
    this.transition(tab)
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.requireTab(id), ids = [...this.tabs.keys()], index = ids.indexOf(id)
    if (this.activeTabId === id && (this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    const browser = this.isBrowser()
    this.tabs.delete(id)
    this.selections.clear(id)
    tab.history.dispose()
    if (!this.tabs.size) { await this.createTab(); return }
    if (this.activeTabId === id) {
      this.activeTabId = ids[index + 1] ?? ids[index - 1]
      const next = this.requireTab(this.activeTabId)
      if (browser) next.history.showPage({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'browser' } })
      this.transition(next)
    } else this.publishState()
  }

  async openAskSession(isCurrent: () => boolean): Promise<boolean> {
    if (!isCurrent() || this.window.isDestroyed()) return false
    const tab = this.requireTab(this.activeTabId), destination = this.tabState(tab).destination
    if (destination.kind === 'internal' && destination.page === 'ai') return true
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave(isCurrent))) return false
    if (!isCurrent() || this.window.isDestroyed() || this.activeTabId !== tab.id) return false
    tab.history.showPage({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'ai' } })
    this.transition(tab)
    return true
  }

  async navigate(input: string, surface: 'browser' | 'inbox' = 'browser'): Promise<void> {
    let destination = resolveDestination(input) // Reject invalid input before mutating either history.
    const tab = this.requireTab(this.activeTabId)
    const inbox = destination.kind === 'internal' && destination.page === 'inbox'
    if (inbox) {
      const inboxURL = this.getInboxURL()
      if (inboxURL) { destination = resolveDestination(inboxURL); surface = 'inbox' }
    }
    if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
    if (destination.kind === 'internal') {
      tab.history.showPage({ kind: 'internal', id: randomUUID(), destination })
      this.transition(tab)
      return
    }
    let segment = tab.history.segment(surface)
    // Reopening Inbox resumes its live page/draft when its configured entry URL is unchanged.
    if (inbox && segment && !segment.error && segment.entryURL === destination.url) {
      tab.history.showWeb(segment); this.transition(tab); return
    }
    if (!segment) {
      const created: WebSegment = new WebSegment(this.window, () => {
        if (!this.tabs.has(tab.id)) return
        this.updateVisibility(); this.publishState()
      }, (url) => {
        void (async () => {
          if ((this.unsaved || this.isKnowledge()) && !(await this.confirmLeave())) return
          await this.createTab(); await this.navigate(url, created.surface)
        })().catch(() => { /* The popup's load error belongs to its own tab. */ })
      }, surface, {
        identity: () => this.activeBrowserTarget(tab, created),
        accept: (target, content) => this.handoff(tab, created, target, content),
        travel: direction => { if (this.activeBrowserTarget(tab, created)) void this.travel(direction) },
        requestCopy: () => { void this.copyFromMenu() }
      }, this.smartPaste)
      this.raiseBanner?.()
      segment = created
      this.shortcuts(created.view.webContents)
    }
    tab.history.showWeb(segment)
    segment.trimForward()
    // Establish a web destination before publishing or asking React to present it.
    segment.url = destination.url
    this.transition(tab)
    await segment.navigate(destination.url)
  }

  back(): Promise<void> { return this.travel(-1) }
  forward(): Promise<void> { return this.travel(1) }
  async reload(): Promise<void> {
    const item = this.requireTab(this.activeTabId).history.current
    if (item.kind === 'web' && item.segment.surface === 'browser') item.segment.reload()
  }

  async copyWebpage(): Promise<void> {
    const tab = this.tabs.get(this.activeTabId), item = tab?.history.current
    if (!tab || item?.kind !== 'web' || !this.activeBrowserTarget(tab, item.segment)) {
      throw new Error(t($ => $.browser.copyFailed))
    }
    const targetId = this.targetId(tab)
    await item.segment.copyWebpage(() => this.activeBrowserTarget(tab, item.segment) === targetId)
  }

  private async copyFromMenu(): Promise<void> {
    const tab = this.tabs.get(this.activeTabId)
    if (!tab) return
    const presentation = { tabId: tab.id, targetId: this.targetId(tab) }
    const copied = await this.copyWebpage().then(() => true, () => false)
    if (!this.window.isDestroyed()) this.window.webContents.send(BROWSER_COPY_WEBPAGE_RESULT, presentation, copied)
  }

  getState(): BrowserState {
    return { language: i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en', theme: resolvedTheme(), revision: this.revision, tabs: [...this.tabs.values()].map((tab) => this.tabState(tab)), activeTabId: this.activeTabId }
  }

  private tabState(tab: Tab): BrowserTabState {
    const item = tab.history.current
    const destination = item.kind === 'internal' ? item.destination : { kind: 'web' as const, url: item.segment.url,
      ...(item.segment.surface === 'inbox' ? { surface: 'inbox' as const } : {}) }
    return {
      id: tab.id, browserTitle: tab.history.segment('browser')?.title || t($ => $.browser.newTab), destination, targetId: this.targetId(tab),
      title: item.kind === 'internal' ? t($ => $.navigation.pages[item.destination.page]) : item.segment.surface === 'inbox' ? t($ => $.navigation.pages.inbox) : item.segment.title,
      url: destination.kind === 'web' ? destination.url : '',
      canGoBack: tab.history.canGoBack, canGoForward: tab.history.canGoForward,
      isLoading: item.kind === 'web' && item.segment.isLoading,
      error: item.kind === 'web' ? item.segment.error : ''
    }
  }

  private isBrowser(): boolean { return isBrowserDestination(this.tabState(this.requireTab(this.activeTabId)).destination) }

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
    this.transition(tab, true)
  }

  private transition(tab: Tab, preserveSurface = false): void {
    this.selections.dispose()
    this.unsaved = false
    tab.version++
    if (!preserveSurface) this.visible = false // History keeps its gray native cover across the target change.
    this.updateVisibility(); this.publishState()
  }

  private activeBrowserTarget(tab: Tab, segment: WebSegment): string | null {
    return !this.window.isDestroyed() && !this.rendererLoading && this.visible && this.activeTabId === tab.id && this.tabs.has(tab.id) &&
      tab.history.current.kind === 'web' && tab.history.current.segment === segment && segment.surface === 'browser' ? this.targetId(tab) : null
  }

  private handoff(tab: Tab, segment: WebSegment, target: SelectionTarget, content: Pick<WebSelection, 'text' | 'source'>): void {
    if (!this.activeBrowserTarget(tab, segment)) return
    this.selections.dispose()
    tab.history.showPage({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: target === 'ask-ai' ? 'ai' : 'find' } })
    tab.version++; this.unsaved = false; this.visible = false
    this.selections.put({ tabId: tab.id, targetId: this.targetId(tab) }, { id: randomUUID(), target, ...content })
    this.updateVisibility(); this.publishState()
  }

  private selectionTarget(presentation: Presentation): SelectionTarget | null {
    const tab = this.tabs.get(this.activeTabId)
    if (!tab || tab.id !== presentation.tabId || this.targetId(tab) !== presentation.targetId) return null
    const item = tab.history.current
    return item.kind === 'internal' ? item.destination.page === 'ai' ? 'ask-ai' : item.destination.page === 'find' ? 'job-import' : null : null
  }

  peekSelection(presentation: Presentation): WebSelection | null {
    const target = this.selectionTarget(presentation)
    return target ? this.selections.peek(presentation, target) : null
  }

  ackSelection(input: Presentation & { id: string }): void {
    const target = this.selectionTarget(input)
    if (target) this.selections.ack(input, input.id, target)
  }

  private updateVisibility(): void {
    if (this.rendererLoading || !this.visible) void this.showSidebarTooltip(null)
    for (const tab of this.tabs.values()) for (const item of tab.history.items) {
      if (item.kind === 'web') item.segment.setVisible(!this.rendererLoading && this.visible && tab.id === this.activeTabId && item === tab.history.current)
    }
    if (!this.window.isDestroyed()) this.layout()
  }

  private shortcuts(contents: WebContents): void {
    installShortcuts(contents, {
      back: () => this.back(), forward: () => this.forward(), createTab: () => this.createTab(),
      closeActive: () => { if (this.isBrowser()) void this.closeTab(this.activeTabId) },
      cycle: (direction) => {
        if (!this.isBrowser()) return
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
