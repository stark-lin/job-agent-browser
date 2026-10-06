interface NativeHistorySource {
  isDestroyed(): boolean
  debugger: { attach(version: string): void; sendCommand(method: string): Promise<unknown> }
}

/** Electron exposes indices but no entry IDs. Chromium's internal Page domain
 * supplies stable IDs, including distinct entries that share the same URL.
 * This observer never injects scripts or exposes debugging to remote pages. */
export class NativeHistoryIdentity {
  private readonly seen = new Set<number>()
  private generation = 0

  constructor(private readonly contents: NativeHistorySource) {
    contents.debugger.attach('1.3')
  }

  async committed(): Promise<boolean> {
    const generation = ++this.generation
    const value: unknown = await this.contents.debugger.sendCommand('Page.getNavigationHistory')
    if (generation !== this.generation || this.contents.isDestroyed()) return false
    if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries) ||
      !('currentIndex' in value) || typeof value.currentIndex !== 'number') {
      throw new Error('Invalid native history snapshot.')
    }
    const entries: unknown[] = value.entries
    const ids = entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'number') {
        throw new Error('Invalid native history entry.')
      }
      return entry.id
    })
    const id = ids[value.currentIndex]
    const added = id !== undefined && !this.seen.has(id)
    for (const entryId of ids) this.seen.add(entryId)
    return added
  }
}
