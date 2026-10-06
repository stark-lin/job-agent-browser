import { randomUUID } from 'node:crypto'
import { session, type BrowserWindow, type WebContents } from 'electron'
import { BROWSER_CHROME_HEIGHT, BROWSER_FOCUS_ADDRESS, BROWSER_STATE_CHANGED,
  type BrowserState, type BrowserTabState, type Presentation } from '../../shared/browser'
import { internalPages, isBrowserDestination } from '../../shared/navigation'
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

  constructor(private readonly window: BrowserWindow) {
    session.fromPartition(SESSION_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.createTab()
    this.shortcuts(window.webContents)
    window.webContents.on('did-start-loading', () => {
      // Invalidate acknowledgments from the previous renderer document as well
      // as hiding its views until the new React tree has committed.
      const tab = this.tabs.get(this.activeTabId)
      if (tab) this.transition(tab)
    })
    window.on('resize', () => this.layout())
    window.on('closed', () => {
      for (const tab of this.tabs.values()) tab.history.dispose()
      this.tabs.clear()
    })
  }

  isTrustedSender(senderId: number): boolean {
    return !this.window.isDestroyed() && this.window.webContents.id === senderId
  }

  layout(): void {
    const { width, height } = this.window.getContentBounds()
    for (const tab of this.tabs.values()) for (const item of tab.history.items) {
      if (item.kind === 'web') item.segment.view.setBounds({
        x: 0, y: BROWSER_CHROME_HEIGHT, width, height: Math.max(0, height - BROWSER_CHROME_HEIGHT)
      })
    }
  }

  setVisible(visible: boolean, presentation: Presentation): void {
    const tab = this.requireTab(this.activeTabId)
    if (presentation.tabId !== tab.id || presentation.targetId !== this.targetId(tab)) return
    this.visible = visible && isBrowserDestination(this.tabState(tab).destination)
    this.updateVisibility()
  }

  createTab(): void {
    const tab: Tab = { id: randomUUID(), version: 0, history: new MixedHistory() }
    tab.history.append({ kind: 'internal', id: randomUUID(), destination: { kind: 'internal', page: 'home' } })
    this.tabs.set(tab.id, tab)
    this.activeTabId = tab.id
    this.transition(tab)
  }

  activateTab(id: string): void {
    const tab = this.requireTab(id)
    if (this.activeTabId === id) return
    this.activeTabId = id
    this.transition(tab)
  }

  closeTab(id: string): void {
    const tab = this.requireTab(id), ids = [...this.tabs.keys()], index = ids.indexOf(id)
    this.tabs.delete(id)
    tab.history.dispose()
    if (!this.tabs.size) { this.createTab(); return }
    if (this.activeTabId === id) {
      this.activeTabId = ids[index + 1] ?? ids[index - 1]
      this.transition(this.requireTab(this.activeTabId))
    } else this.publishState()
  }

  async navigate(input: string): Promise<void> {
    const destination = resolveDestination(input) // Reject invalid input before mutating either history.
    const tab = this.requireTab(this.activeTabId)
    if (destination.kind === 'internal') {
      tab.history.append({ kind: 'internal', id: randomUUID(), destination })
      this.transition(tab)
      return
    }
    tab.history.branch()
    let segment: WebSegment
    if (tab.history.current.kind === 'web') segment = tab.history.current.segment
    else {
      segment = new WebSegment(this.window, (newEntry) => {
        if (!this.tabs.has(tab.id)) return
        if (newEntry && tab.history.current.kind === 'web' && tab.history.current.segment === segment) tab.history.discardFuture()
        this.updateVisibility(); this.publishState()
      }, (url) => {
        this.createTab()
        void this.navigate(url).catch(() => { /* The popup's load error belongs to its own tab. */ })
      })
      this.shortcuts(segment.view.webContents)
      tab.history.append({ kind: 'web', id: segment.id, segment })
    }
    // Establish a web destination before publishing or asking React to present it.
    segment.url = destination.url
    this.transition(tab)
    await segment.navigate(destination.url)
  }

  back(): void { this.travel(-1) }
  forward(): void { this.travel(1) }

  getState(): BrowserState {
    return { revision: this.revision, tabs: [...this.tabs.values()].map((tab) => this.tabState(tab)), activeTabId: this.activeTabId }
  }

  private tabState(tab: Tab): BrowserTabState {
    const item = tab.history.current
    const destination = item.kind === 'internal' ? item.destination : { kind: 'web' as const, url: item.segment.url }
    return {
      id: tab.id, destination, targetId: this.targetId(tab),
      title: item.kind === 'internal' ? internalPages[item.destination.page] : item.segment.title,
      url: destination.kind === 'web' ? destination.url : '',
      canGoBack: tab.history.canGoBack, canGoForward: tab.history.canGoForward,
      isLoading: item.kind === 'web' && item.segment.isLoading,
      error: item.kind === 'web' ? item.segment.error : ''
    }
  }

  private targetId(tab: Tab): string { return `${tab.history.current.id}:${tab.version}` }
  private requireTab(id: string): Tab {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error('Tab is no longer available.')
    return tab
  }

  private travel(direction: -1 | 1): void {
    const tab = this.requireTab(this.activeTabId)
    if (direction === -1 ? !tab.history.canGoBack : !tab.history.canGoForward) return
    tab.history.travel(direction)
    this.transition(tab)
  }

  private transition(tab: Tab): void {
    tab.version++
    this.visible = false // React acknowledges the new target after its Browser page commits.
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
