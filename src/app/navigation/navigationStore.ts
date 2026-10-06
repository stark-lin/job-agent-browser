import { t } from '../../shared/i18n'
import type { BrowserAPI, BrowserState } from '../../shared/browser'

export interface NavigationSnapshot {
  browser: BrowserState
  error: { tabId: string; targetId: string; message: string } | null
}

/** One subscribed projection of Main state, independent of page mount/unmount. */
export class NavigationStore {
  private snapshot: NavigationSnapshot = { browser: { revision: -1, tabs: [], activeTabId: '' }, error: null }
  private readonly listeners = new Set<() => void>()
  private generation = 0

  constructor(readonly api: BrowserAPI) {}
  getSnapshot = (): NavigationSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(): () => void {
    const generation = ++this.generation
    const accept = (browser: BrowserState): void => {
      if (generation !== this.generation || browser.revision < this.snapshot.browser.revision) return
      this.snapshot = { ...this.snapshot, browser }
      this.emit()
    }
    const unsubscribe = this.api.onStateChange(accept)
    void this.api.getState().then(accept).catch((reason: unknown) => {
      if (generation === this.generation) this.report(reason, '', '')
    })
    return () => { this.generation++; unsubscribe() }
  }

  async run(action: () => Promise<void>): Promise<void> {
    const browser = this.snapshot.browser
    const active = browser.tabs.find((tab) => tab.id === browser.activeTabId)
    this.snapshot = { ...this.snapshot, error: null }; this.emit()
    try { await action() } catch (reason) { this.report(reason, active?.id ?? '', active?.targetId ?? '') }
  }

  private report(reason: unknown, tabId: string, targetId: string): void {
    const message = reason instanceof Error
      ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
      : t($ => $.errors.actionFailed)
    this.snapshot = { ...this.snapshot, error: { tabId, targetId, message } }
    this.emit()
  }
  private emit(): void { for (const listener of this.listeners) listener() }
}
