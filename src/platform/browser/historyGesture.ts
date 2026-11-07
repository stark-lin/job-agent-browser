import type { WebContents } from 'electron'
import type { HistoryDrag } from './historyDrag'

/** Only this view's isolated top-frame preload may supply bounded gesture deltas. */
export function installHistoryWheel(contents: WebContents, drag: HistoryDrag, active: () => boolean, epoch: () => number): () => void {
  const sync = () => { if (!contents.isDestroyed()) contents.send('browser:gesture-state', { enabled: active(), epoch: epoch() }) }
  contents.on('did-finish-load', sync)
  contents.ipc.on('browser:gesture-wheel', (event, raw: unknown) => {
    if (!active() || event.senderFrame !== contents.mainFrame || !raw || typeof raw !== 'object') return
    const input = raw as { epoch?: unknown; delta?: unknown; end?: unknown }
    if (input.epoch !== epoch()) return
    if (input.end === true) drag.endWheel()
    else if (typeof input.delta === 'number' && Number.isFinite(input.delta) && Math.abs(input.delta) <= 4096) drag.wheel(input.delta)
  })
  return sync
}
