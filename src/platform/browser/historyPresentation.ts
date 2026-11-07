/** A history target stays covered until its own compositor frame is ready. */
export class HistoryPresentation {
  private revision = 0
  private waiting = false
  private disposed = false

  constructor(private readonly showCover: (visible: boolean) => void, private readonly prepareFrame: () => Promise<void>) {}

  get pending(): boolean { return this.waiting }

  begin(): void {
    if (this.disposed) return
    this.revision++
    this.waiting = true
    this.showCover(true)
  }

  async ready(): Promise<void> {
    if (!this.waiting || this.disposed) return
    const revision = this.revision
    try { await this.prepareFrame() } catch { /* Failed loads must retain ordinary error/retry recovery. */ }
    if (this.disposed || revision !== this.revision) return
    this.waiting = false
    this.showCover(false)
  }

  dispose(): void { this.disposed = true; this.revision++; this.waiting = false }
}
