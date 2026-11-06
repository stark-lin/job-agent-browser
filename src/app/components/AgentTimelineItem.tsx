import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentItem, AgentRun } from '../../domain/chat/chat.types'
import { ActivityRow, ChatMessage, CodeBlock, Collapsible, DetailsList, Markdown, StatusMessage } from '../../shared/ui'
function AgentTimelineItemView({ item, run }: { item: AgentItem; run?: AgentRun }) {
  const { t, i18n } = useTranslation(), content = item.content
  const copy = { copyLabel: t($ => $.ask.copyContent), copiedLabel: t($ => $.ask.copied) }
  if (content.type === 'user_message') return <ChatMessage user>{content.text}</ChatMessage>
  if (content.type === 'assistant_message') return <ChatMessage><Markdown text={content.text} copyLabel={t($ => $.ask.copy)} copiedLabel={t($ => $.ask.copied)} /></ChatMessage>
  if (content.type === 'reasoning') {
    const kind = content.reasoning?.kind
    const title = kind === 'summary' ? t($ => $.ask.summary) : kind === 'encrypted' ? t($ => $.ask.encryptedReasoning) : t($ => $.ask.reasoning)
    const state = t($ => $.ask.itemStates[item.state])
    return <Collapsible label={`${title} · ${state}`} streaming={item.state === 'streaming'}>
      <DetailsList items={[
        ...(content.reasoning ? [{ label: t($ => $.ask.source), value: content.reasoning.source }] : []),
        { label: t($ => $.ask.elapsed), value: t($ => $.ask.duration, { seconds: Math.max(0, (Date.parse(item.updatedAt) - Date.parse(item.createdAt)) / 1000).toFixed(1) }) }
      ]} />
      {kind === 'encrypted' ? <StatusMessage>{t($ => $.ask.encryptedUnavailable)}</StatusMessage>
        : <CodeBlock text={content.text} language={title} wrap {...copy} />}
    </Collapsible>
  }
  if (content.type !== 'tool_call') return null
  const action = t($ => $.ask.tools[content.display.key])
  const description = item.state === 'uncertain' ? t($ => $.ask.uncertain) : content.display.count !== undefined ? t($ => $.ask.count, { count: content.display.count })
    : content.display.status ? t($ => $.ask.status, { status: t($ => $.jobs.statuses[content.display.status as keyof typeof $.jobs.statuses]) }) : content.display.startsAt ? t($ => $.ask.scheduled, { date: new Date(content.display.startsAt).toLocaleString(i18n.language) }) : undefined
  const label = content.guard?.executed === false ? `${action} · ${t($ => $.ask.guard.notExecuted)}` : item.state === 'running' ? t($ => $.ask.toolRunning, { action }) : item.state === 'failed' || item.state === 'uncertain' ? t($ => $.ask.toolFailed, { action })
    : item.state === 'cancelled' || item.state === 'interrupted' ? `${action} · ${t($ => $.ask.itemStates[item.state])}` : action
  return <ActivityRow state={item.state} label={label} description={description}>
    <Collapsible label={t($ => $.ask.details)}>
      <DetailsList items={[
        { label: t($ => $.ask.guard.runId), value: item.runId },
        ...(run ? [{ label: t($ => $.ask.guard.runState), value: t($ => $.ask.itemStates[run.state]) }] : []),
        { label: t($ => $.ask.toolName), value: content.toolName },
        ...(content.callId ? [{ label: t($ => $.ask.callId), value: content.callId }] : []),
        { label: t($ => $.ask.executionState), value: t($ => $.ask.itemStates[item.state]) },
        ...(content.durationMs !== undefined ? [{ label: t($ => $.ask.elapsed), value: t($ => $.ask.duration, { seconds: (content.durationMs / 1000).toFixed(1) }) }] : [])
      ]} />
      {content.guard && <DetailsList items={[
        { label: t($ => $.ask.guard.status), value: t($ => $.ask.guard[content.guard!.status === 'BLOCKED' ? 'blocked' : 'active']) },
        { label: t($ => $.ask.guard.calls), value: String(content.guard.calls) },
        { label: t($ => $.ask.guard.executedCalls), value: String(content.guard.executedCalls) },
        { label: t($ => $.ask.guard.rejections), value: String(content.guard.rejections) },
        { label: t($ => $.ask.guard.noProgress), value: String(content.guard.noProgress) },
        ...(content.guard.level ? [{ label: t($ => $.ask.guard.level), value: t($ => $.ask.guard[content.guard!.level!]) },
          { label: t($ => $.ask.guard.nextAction), value: t($ => $.ask.guard.changeStrategy) }] : []),
        ...(content.guard.reason ? [{ label: t($ => $.ask.guard.reason), value: t($ => $.ask.guard.reasons[content.guard!.reason!]) }] : []),
        ...content.guard.effects.map(effect => ({ label: t($ => $.ask.guard.confirmedEffect), value: `${effect.id} · ${t($ => $.ask.guard[effect.archived ? 'archived' : 'restored'])}` }))
      ]} />}
      {content.arguments !== undefined && <CodeBlock language={t($ => $.ask.arguments)} text={JSON.stringify(content.arguments, null, 2)} {...copy} />}
      {content.result !== undefined && <CodeBlock language={t($ => $.ask.result)} text={JSON.stringify(content.result, null, 2)} {...copy} />}
      {content.error && <CodeBlock language={t($ => $.ask.toolError)} text={content.error} wrap {...copy} />}
    </Collapsible>
  </ActivityRow>
}

export const AgentTimelineItem = memo(AgentTimelineItemView)
