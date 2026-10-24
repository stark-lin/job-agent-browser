import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem } from '../../domain/chat/chat.types'
import { ActivityRow, ChatMessage, Collapsible, Markdown } from '../../shared/ui'
function TimelineItemView({ item }: { item: ChatItem }) {
  const { t, i18n } = useTranslation(), content = item.content
  if (content.type === 'user_message') return <ChatMessage user>{content.text}</ChatMessage>
  if (content.type === 'assistant_message') return <ChatMessage><Markdown text={content.text} copyLabel={t($ => $.ask.copy)} copiedLabel={t($ => $.ask.copied)} /></ChatMessage>
  if (content.type === 'reasoning') return <Collapsible label={item.state === 'streaming' ? t($ => $.ask.thinking) : t($ => $.ask.thought, { seconds: Math.max(1, Math.round((Date.parse(item.updatedAt) - Date.parse(item.createdAt)) / 1000)) })} streaming={item.state === 'streaming'}>{content.text}</Collapsible>
  if (content.type !== 'tool_call') return null
  const action = t($ => $.ask.tools[content.display.key])
  const description = item.state === 'uncertain' ? t($ => $.ask.uncertain) : content.display.count !== undefined ? t($ => $.ask.count, { count: content.display.count })
    : content.display.status ? t($ => $.ask.status, { status: t($ => $.jobs.statuses[content.display.status as keyof typeof $.jobs.statuses]) }) : content.display.startsAt ? t($ => $.ask.scheduled, { date: new Date(content.display.startsAt).toLocaleString(i18n.language) }) : undefined
  return <ActivityRow state={item.state} label={item.state === 'running' ? t($ => $.ask.toolRunning, { action }) : item.state === 'failed' || item.state === 'uncertain' ? t($ => $.ask.toolFailed, { action }) : action} description={description}>
    {content.durationMs !== undefined && <Collapsible label={t($ => $.ask.details)}>{t($ => $.ask.duration, { seconds: (content.durationMs / 1000).toFixed(1) })}</Collapsible>}
  </ActivityRow>
}

export const TimelineItem = memo(TimelineItemView)
