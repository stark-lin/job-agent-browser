import type { Destination } from '../../shared/navigation'

/** Each surface retains its own native history; workspace pages are not history entries. */
export interface HistorySegment {
  id: string
  surface: 'browser' | 'inbox'
  index: number
  length: number
  move(index: number): void
  trimForward(): void
  dispose(): void
}

type InternalItem = { kind: 'internal'; id: string; destination: Extract<Destination, { kind: 'internal' }> }
type WebItem<S extends HistorySegment> = { kind: 'web'; id: string; segment: S }
export type NavigationItem<S extends HistorySegment> = InternalItem | WebItem<S>

export class TabNavigation<S extends HistorySegment> {
  private readonly surfaces = new Map<S['surface'], WebItem<S>>()
  current: NavigationItem<S>

  constructor(initial: InternalItem) { this.current = initial }

  get items(): WebItem<S>[] { return [...this.surfaces.values()] }
  segment(surface: S['surface']): S | undefined { return this.surfaces.get(surface)?.segment }

  showPage(item: InternalItem): void {
    this.current = item.destination.page === 'browser' ? this.surfaces.get('browser') ?? item : item
  }

  showWeb(segment: S): void {
    const previous = this.segment(segment.surface)
    if (previous && previous !== segment) previous.dispose()
    const item: WebItem<S> = { kind: 'web', id: segment.id, segment }
    this.surfaces.set(segment.surface, item)
    this.current = item
  }

  private get browser(): S | undefined {
    return this.current.kind === 'web' && this.current.segment.surface === 'browser' ? this.current.segment : undefined
  }
  get canGoBack(): boolean { return !!this.browser && this.browser.index > 0 }
  get canGoForward(): boolean { return !!this.browser && this.browser.index < this.browser.length - 1 }

  travel(direction: -1 | 1): void {
    if (direction === -1 ? this.canGoBack : this.canGoForward) this.browser!.move(this.browser!.index + direction)
  }

  dispose(): void {
    for (const item of this.surfaces.values()) item.segment.dispose()
    this.surfaces.clear()
  }
}
