import type { Presentation } from '../../shared/browser'
import type { SelectionTarget, WebSelection } from '../../shared/browser-selection'

export const SELECTION_TTL = 5 * 60_000
/** Main-only transport. Payloads never enter browser snapshots or persistence. */
export class SelectionHandoff {
  private pending = new Map<string, { presentation: Presentation; selection: WebSelection; expires: number; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly now = Date.now) {}
  put(presentation: Presentation, selection: WebSelection): void {
    this.clear(presentation.tabId)
    const timer = setTimeout(() => this.clear(presentation.tabId), SELECTION_TTL)
    timer.unref()
    this.pending.set(presentation.tabId, { presentation, selection, expires: this.now() + SELECTION_TTL, timer })
  }
  peek(presentation: Presentation, target: SelectionTarget): WebSelection | null {
    const item = this.pending.get(presentation.tabId)
    if (!item) return null
    if (item.expires <= this.now()) { this.clear(presentation.tabId); return null }
    return item.presentation.targetId === presentation.targetId && item.selection.target === target ? structuredClone(item.selection) : null
  }
  ack(presentation: Presentation, id: string, target: SelectionTarget): void {
    if (this.peek(presentation, target)?.id === id) this.clear(presentation.tabId)
  }
  clear(tabId: string): void {
    const item = this.pending.get(tabId)
    if (item) clearTimeout(item.timer)
    this.pending.delete(tabId)
  }
  dispose(): void { for (const id of this.pending.keys()) this.clear(id) }
}
