import type { MouseInputEvent } from 'electron'
import { HISTORY_DRAG_SLOP, HISTORY_DRAG_THRESHOLD, UI_MOTION_MS } from '../../shared/ui/geometry'

export interface HistoryFeedback {
  direction: -1 | 1
  available: boolean
  ready: boolean
}

export interface HistoryDragActions {
  identity(): string | null
  canTravel(direction: -1 | 1): boolean
  width(): number
  draw(feedback: HistoryFeedback | null): void
  travel(direction: -1 | 1): void
  click(): void
  dismiss(): void
}

/** Both inputs use one navigation decision, tied to the active document/target. */
export class HistoryDrag {
  private start?: { x: number; y: number; identity: string }
  private dragging = false
  private vertical = false
  private distance = 0
  private wheelIdentity: string | null = null
  private suppressedUntil = 0

  constructor(private readonly actions: HistoryDragActions) {}

  get tracking(): boolean { return !!this.start }
  get active(): boolean { return this.tracking || !!this.wheelIdentity || this.dragging }
  get blocksMenu(): boolean { return this.dragging || Date.now() < this.suppressedUntil }

  handle(mouse: MouseInputEvent): boolean {
    if (mouse.type === 'mouseDown' && mouse.button === 'right') {
      if (this.wheelIdentity) return true
      this.cancel()
      const identity = this.actions.identity()
      if (identity) this.start = { x: mouse.x, y: mouse.y, identity }
      this.suppressedUntil = 0
      return false
    }
    if (!this.start) return false
    if (this.actions.identity() !== this.start.identity) { this.cancel(); return false }
    if (mouse.type === 'mouseUp' && mouse.button === 'right') {
      this.update(mouse.x, mouse.y)
      const consumed = this.dragging
      this.start = undefined
      if (!consumed) { this.actions.click(); return false }
      this.release()
      return true
    }
    if (mouse.type === 'mouseMove') {
      if (!mouse.modifiers?.includes('rightbuttondown')) { this.cancel(); return false }
      this.update(mouse.x, mouse.y)
      return this.dragging
    }
    if (mouse.type === 'mouseDown' || mouse.type === 'mouseLeave' && !mouse.modifiers?.includes('rightbuttondown')) this.cancel()
    return false
  }

  wheel(distance: number): void {
    if (this.start || Date.now() < this.suppressedUntil) return
    const identity = this.actions.identity()
    if (!identity || this.wheelIdentity && identity !== this.wheelIdentity) { this.cancel(); return }
    this.wheelIdentity = identity
    this.distance += distance
    if (Math.abs(this.distance) < HISTORY_DRAG_SLOP && !this.dragging) return
    this.dragging = true
    this.actions.dismiss()
    this.draw()
  }

  endWheel(): void {
    if (!this.wheelIdentity) return
    const valid = this.wheelIdentity === this.actions.identity()
    this.wheelIdentity = null
    if (!valid || !this.dragging) { this.cancel(); return }
    this.release()
  }

  cancel(): void {
    this.start = undefined; this.dragging = false; this.vertical = false; this.wheelIdentity = null
    this.distance = 0
    this.actions.draw(null); this.actions.dismiss()
  }

  private update(x: number, y: number): void {
    if (!this.start || this.vertical) return
    const dx = x - this.start.x, dy = y - this.start.y
    if (!this.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < HISTORY_DRAG_SLOP) return
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) { this.vertical = true; return }
      this.dragging = true
      this.actions.dismiss()
    }
    this.distance = dx
    this.draw()
  }

  private draw(): void {
    if (!this.distance) { this.actions.draw(null); return }
    const direction = this.distance > 0 ? -1 : 1
    const available = this.actions.canTravel(direction)
    this.actions.draw({ direction, available, ready: available && Math.abs(this.distance) >= this.threshold })
  }

  private get threshold(): number { return Math.min(HISTORY_DRAG_THRESHOLD, this.actions.width() / 4) }

  private release(): void {
    const direction = this.distance > 0 ? -1 : 1
    const commit = Math.abs(this.distance) >= this.threshold && this.actions.canTravel(direction)
    this.suppressedUntil = Date.now() + UI_MOTION_MS * 2
    this.dragging = false; this.distance = 0
    this.actions.dismiss()
    this.actions.draw(null)
    if (commit) this.actions.travel(direction)
  }
}
