import type { Destination } from '../../shared/navigation'

/** Native history stays inside its segment; internal entries never load in Chromium. */
export interface HistorySegment {
  id: string
  index: number
  length: number
  move(index: number): void
  trimForward(): void
  dispose(): void
}

export type HistoryItem<S extends HistorySegment> =
  | { kind: 'internal'; id: string; destination: Extract<Destination, { kind: 'internal' }> }
  | { kind: 'web'; id: string; segment: S }

export class MixedHistory<S extends HistorySegment> {
  readonly items: HistoryItem<S>[] = []
  private cursor = -1

  get current(): HistoryItem<S> { return this.items[this.cursor] }
  get canGoBack(): boolean {
    return this.cursor > 0 || (this.current?.kind === 'web' && this.current.segment.index > 0)
  }
  get canGoForward(): boolean {
    return this.cursor < this.items.length - 1 || (this.current?.kind === 'web' && this.current.segment.index < this.current.segment.length - 1)
  }

  append(item: HistoryItem<S>): void {
    this.branch()
    this.items.push(item)
    this.cursor = this.items.length - 1
  }

  /** User navigation branches both stacks; traversal must never call this. */
  branch(): void {
    if (this.current?.kind === 'web') this.current.segment.trimForward()
    this.discardFuture()
  }

  discardFuture(): void {
    for (const item of this.items.splice(this.cursor + 1)) {
      if (item.kind === 'web') item.segment.dispose()
    }
  }

  travel(direction: -1 | 1): void {
    if (direction === -1 ? !this.canGoBack : !this.canGoForward) return
    const current = this.current
    if (current.kind === 'web') {
      const next = current.segment.index + direction
      if (next >= 0 && next < current.segment.length) {
        current.segment.move(next)
        return
      }
    }
    this.cursor += direction
    const item = this.current
    if (item.kind === 'web') item.segment.move(direction === -1 ? item.segment.length - 1 : 0)
  }

  dispose(): void {
    for (const item of this.items) if (item.kind === 'web') item.segment.dispose()
    this.items.length = 0
    this.cursor = -1
  }
}
