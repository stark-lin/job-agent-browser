import { randomUUID } from 'node:crypto'
import { clipboard, type BrowserWindow } from 'electron'
import { t } from '../../shared/i18n'
import { smartPasteSettings } from '../../shared/smart-paste'
import type { Preferences } from '../../shared/settings'
import type { AgentRunEvent } from '../../domain/chat/chat.types'
import type { BannerService } from '../banner/bannerService'
import type { SmartPasteTarget } from '../browser/smartPasteField'
import type { AskAgentTasks } from '../electron/ask-agent-tasks'
import { ASK_AGENT_EVENT } from '../electron/ask-agent-contract'
import { buildSmartPasteMessage } from './prompt'

type Phase = 'preparing' | 'reading' | 'filling' | 'done' | 'stopped' | 'failed' | 'noModel'

export class SmartPasteService {
  constructor(private readonly preferences: () => Preferences, private readonly ask: AskAgentTasks, private readonly banner: BannerService) {}

  configs() { return smartPasteSettings(this.preferences()).configs }

  async start(window: BrowserWindow, configId: string, target: SmartPasteTarget, page: { title: string; url: string }) {
    let sessionId: string | undefined
    let runId: string | undefined
    let title = ''
    let phase: Phase | undefined
    const notify = (next: Phase) => {
      if (window.isDestroyed() || phase === next) return
      phase = next
      this.banner.publish({ timeUs: this.banner.nextTime(), title: t($ => $.smartPaste.title),
        detail: t($ => $.smartPaste[next], { title }),
        ...(sessionId ? { action: { type: 'open-ask-session', sessionId } } : {}) })
    }
    const owner = window.webContents
    const frame = owner.mainFrame, ownerId = owner.id
    const cancel = () => { if (runId) this.ask.cancel(ownerId, { runId }) }
    let chain = Promise.resolve()
    let interrupted = false
    let failed = false
    let written = false
    const textItems = new Set<string>()
    const enqueue = (operation: () => Promise<boolean>, rollback = false) => {
      chain = chain.then(async () => {
        if (failed || target.signal.aborted || interrupted && !rollback) return
        if (!await operation()) { failed = true; cancel() }
      }).catch(() => { failed = true; cancel() })
    }
    const close = async (outcome: Phase) => {
      try {
        await chain
        const confirmed = await target.finish()
        notify(failed ? 'failed' : target.signal.aborted ? 'stopped' : outcome === 'done' && (!written || !confirmed) ? 'failed' : outcome)
      } finally { target.signal.removeEventListener('abort', cancel) }
    }
    const onEvent = (event: AgentRunEvent) => {
      try {
        if (!owner.isDestroyed() && !frame.detached && owner.mainFrame === frame) frame.send(ASK_AGENT_EVENT, event)
      } catch { /* Owner teardown cancels the run independently. */ }
      if (event.type === 'item.started') {
        if (event.item.phase === 'execute' && event.item.content.type === 'assistant_message') textItems.add(event.item.id)
        if (event.item.content.type === 'tool_call') notify('reading')
      }
      if (event.type === 'item.delta' && textItems.has(event.itemId)) {
        notify('filling')
        enqueue(async () => { const accepted = await target.append(event.delta); written ||= accepted && Boolean(event.delta.trim()); return accepted })
      }
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
        interrupted = event.type === 'run.cancelled'
        void close(event.type === 'run.completed' ? event.run.blockedReason ? 'stopped' : 'done' : event.type === 'run.failed' ? 'failed' : 'stopped')
      }
    }
    target.signal.addEventListener('abort', cancel, { once: true })
    try {
      const preferences = this.preferences(), config = smartPasteSettings(preferences).configs.find(item => item.id === configId)
      if (!config) { await close('stopped'); return }
      title = config.title
      const choice = preferences.ai.default
      if (!choice) { await close('noModel'); return }
      notify('preparing')
      const [text, field] = await Promise.all([clipboard.readText(), target.begin()])
      if (!field || target.signal.aborted || owner.isDestroyed()) { await close('stopped'); return }
      const result = this.ask.start(ownerId, {
        requestId: randomUUID(), message: buildSmartPasteMessage(config.prompt, { clipboard: text, page, field, frameURL: target.frameURL }), choice
      }, onEvent, { onToolTurn: () => enqueue(async () => {
        const accepted = await target.rollback()
        if (accepted) written = false
        return accepted
      }, true) })
      sessionId = result.sessionId
      runId = result.runId
      notify('reading')
    } catch {
      await close('failed')
    }
  }
}
