import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem, ChatRun } from '../../domain/chat/chat.types'
import { Button, StatusMessage } from '../../shared/ui'
import { TimelineItem } from './TimelineItem'
export function ConversationTimeline({ id, items, runs, total, loadOlder, retry, retryEnabled, positions }: {
  id: string; items: ChatItem[]; runs: ChatRun[]; total?: number; retryEnabled: boolean; loadOlder(): Promise<void>; retry(message: string): void; positions: Map<string, number>
}) {
  const { t } = useTranslation(), viewport = useRef<HTMLDivElement>(null), pinned = useRef(!positions.has(id)), initialized = useRef(false)
  const [following, setFollowing] = useState(pinned.current), [loadingOlder, setLoadingOlder] = useState(false), previousHeight = useRef<number | null>(null)
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    if (!initialized.current && (total !== undefined || items.length)) {
      node.scrollTop = positions.get(id) ?? node.scrollHeight; initialized.current = true
      pinned.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; setFollowing(pinned.current)
    } else if (previousHeight.current !== null) { node.scrollTop += node.scrollHeight - previousHeight.current; previousHeight.current = null }
    else if (pinned.current) node.scrollTop = node.scrollHeight
  }, [items, runs, total, id, positions])
  const active = runs.find(r => r.state === 'running'), last = items.at(-1)
  const needsWorking = active && !items.some(i => i.runId === active.id && ['streaming', 'running'].includes(i.state))
  return <div className="ai-timeline-wrap"><div ref={viewport} className="ai-transcript" role="region" aria-label={t($ => $.ask.conversation)} tabIndex={0} onScroll={e => {
    const node = e.currentTarget; positions.set(id, node.scrollTop); pinned.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; setFollowing(pinned.current)
  }}><div className="ai-timeline-content">
    {total !== undefined && items.length < total && <Button variant="ghost" disabled={loadingOlder} onClick={() => {
      previousHeight.current = viewport.current?.scrollHeight ?? null; setLoadingOlder(true)
      void loadOlder().finally(() => setLoadingOlder(false))
    }}>{t($ => $.ask.older)}</Button>}
    {items.map((item, index) => {
      const run = runs.find(r => r.id === item.runId), end = items[index + 1]?.runId !== item.runId
      const error = run?.error, known = error && Object.hasOwn(t($ => $.ask.errors, { returnObjects: true }), error)
      return <Fragment key={item.id}><div data-item-type={item.content.type} data-item-state={item.state}><TimelineItem item={item} /></div>
        {end && run && ['failed', 'cancelled', 'interrupted'].includes(run.state) && <div className="ai-run-result" data-run-state={run.state}>
          <StatusMessage tone={run.state === 'failed' ? 'error' : 'neutral'}>{run.state === 'cancelled' ? t($ => $.ask.stopped) : run.state === 'interrupted' ? t($ => $.ask.interrupted) : known ? t($ => $.ask.errors[error as keyof typeof $.ask.errors]) : t($ => $.ask.failed)}</StatusMessage>
          {run.writeStarted ? <StatusMessage>{t($ => $.ask.reviewWrites)}</StatusMessage> : end && item === last && !active && <Button onClick={() => { const user = items.find(i => i.runId === run.id && i.content.type === 'user_message'); if (user && user.content.type !== 'tool_call') retry(user.content.text) }} disabled={!retryEnabled || !items.some(i => i.runId === run.id && i.content.type === 'user_message')}>{t($ => $.ask.retry)}</Button>}
        </div>}
      </Fragment>
    })}
    {needsWorking && <StatusMessage>{t($ => $.ask.working)}</StatusMessage>}
    <div aria-live="polite" className="ai-live-status">{active ? t($ => $.ask.working) : ''}</div>
  </div></div>{!following && <div className="ai-new-output"><Button onClick={() => { pinned.current = true; setFollowing(true); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight }}>{t($ => $.ask.newOutput)}</Button></div>}</div>
}
