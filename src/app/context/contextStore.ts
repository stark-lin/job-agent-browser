import type { ContextReferences } from './appContext'

export class ContextStore {
  private references: ContextReferences = { jobId: null, profileId: null, artifactId: null }
  private readonly listeners = new Set<() => void>()
  getSnapshot = (): ContextReferences => this.references
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  setReferences(update: Partial<ContextReferences>): void {
    this.references = { ...this.references, ...update }
    for (const listener of this.listeners) listener()
  }
}
