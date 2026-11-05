import { randomUUID } from 'node:crypto'
import type { WebContents, WebFrameMain } from 'electron'
import { FIELD_COMMAND, FIELD_INVALID, FIELD_REPLY, type FieldContext, type FieldOperation } from './smartPasteFieldProtocol'

export interface SmartPasteTarget {
  frameURL?: string
  signal: AbortSignal
  begin(): Promise<FieldContext | null>
  append(text: string): Promise<boolean>
  rollback(): Promise<boolean>
  finish(): Promise<boolean>
}

const contextLimits = { label: 1000, placeholder: 1000, type: 32, currentValue: 16000, nearbyText: 2000, frameTitle: 1000 }
const isFieldContext = (value: unknown): value is FieldContext => value !== null && typeof value === 'object'
  && Object.entries(contextLimits).every(([key, limit]) => {
    const field = (value as Record<string, unknown>)[key]
    return typeof field === 'string' && field.length <= limit
  })

const http = (url: string) => /^https?:\/\//i.test(url)
const frameKey = (frame: WebFrameMain) => `${frame.processId}:${frame.frameToken}`
interface DocumentTarget {
  frame: WebFrameMain
  key: string
  url: string
  ancestors: Set<number>
  controller: AbortController
}

export class SmartPasteField {
  private readonly documents = new Set<DocumentTarget>()
  private readonly requests = new Map<string, { document: DocumentTarget; reply(value: unknown): void }>()
  private readonly active = new Map<string, DocumentTarget>()
  private monitor?: ReturnType<typeof setInterval>

  constructor(private readonly contents: WebContents) {
    contents.ipc.on(FIELD_REPLY, (event, id: unknown, value: unknown) => {
      const request = typeof id === 'string' ? this.requests.get(id) : undefined
      if (request && event.senderFrame && frameKey(event.senderFrame) === request.document.key && this.current(request.document)) request.reply(value)
    })
    contents.ipc.on(FIELD_INVALID, (event, id: unknown) => {
      const target = typeof id === 'string' ? this.active.get(id) : undefined
      if (target && event.senderFrame && frameKey(event.senderFrame) === target.key) target.controller.abort()
    })
    contents.on('did-start-navigation', (details) => {
      const id = details.frame?.frameTreeNodeId
      for (const document of this.documents) {
        if (details.isMainFrame || id !== undefined && document.ancestors.has(id)) document.controller.abort()
      }
    })
    contents.on('render-process-gone', () => this.dispose())
    contents.once('destroyed', () => this.dispose())
  }

  private current(document: DocumentTarget): boolean {
    const { frame } = document
    return !document.controller.signal.aborted && !this.contents.isDestroyed() && !frame.detached && !frame.isDestroyed()
      && frameKey(frame) === document.key && frame.url === document.url
  }

  private send(document: DocumentTarget, operation: FieldOperation, ms = 2000): Promise<unknown> {
    if (!this.current(document)) return Promise.resolve(null)
    const id = randomUUID(), signal = document.controller.signal
    return new Promise(resolve => {
      const fail = () => done(null)
      const done = (value: unknown) => {
        clearTimeout(timer)
        this.requests.delete(id)
        signal.removeEventListener('abort', fail)
        resolve(value)
      }
      const timer = setTimeout(fail, ms)
      signal.addEventListener('abort', fail, { once: true })
      this.requests.set(id, { document, reply: done })
      try { document.frame.send(FIELD_COMMAND, { id, operation }) } catch { fail() }
    })
  }

  async probe(frame: WebFrameMain): Promise<{ start(): SmartPasteTarget | undefined; discard(): void } | undefined> {
    if (frame.detached || !http(frame.url) || !http(this.contents.getURL())) return
    const ancestors = new Set<number>()
    for (let node: WebFrameMain | null = frame; node; node = node.parent) ancestors.add(node.frameTreeNodeId)
    const document: DocumentTarget = { frame, key: frameKey(frame), url: frame.url, ancestors, controller: new AbortController() }
    this.documents.add(document)
    const target = await this.send(document, { type: 'probe' }, 250)
    if (typeof target !== 'string' || !/^[\da-f]{32}$/.test(target) || !this.current(document)) {
      this.documents.delete(document)
      return
    }
    let used = false
    const discard = () => { if (!used) { used = true; document.controller.abort(); this.documents.delete(document) } }
    return { discard, start: () => {
      if (used || !this.current(document)) { discard(); return }
      used = true
      this.active.set(target, document)
      this.monitor ??= setInterval(() => {
        for (const document of this.active.values()) if (!this.current(document)) document.controller.abort()
      }, 250)
      this.monitor.unref()
      const release = () => {
        this.active.delete(target)
        this.documents.delete(document)
        if (!this.active.size) { clearInterval(this.monitor); this.monitor = undefined }
      }
      document.controller.signal.addEventListener('abort', release, { once: true })
      return {
        frameURL: frame.parent ? document.url : undefined, signal: document.controller.signal,
        begin: async () => {
          const value = await this.send(document, { type: 'begin', target })
          return isFieldContext(value) ? value : null
        },
        append: async text => (await this.send(document, { type: 'append', target, text })) === true,
        rollback: async () => (await this.send(document, { type: 'rollback', target })) === true,
        finish: async () => {
          const result = await this.send(document, { type: 'finish', target })
          release()
          return result === true
        }
      }
    } }
  }

  dispose(): void {
    for (const document of this.documents) document.controller.abort()
    this.documents.clear()
    clearInterval(this.monitor)
    this.monitor = undefined
  }
}
