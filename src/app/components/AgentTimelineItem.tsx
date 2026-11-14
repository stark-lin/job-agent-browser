import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat'
import { UntrustedProse } from '../content/UntrustedProse'
import { useCopyFeedback } from '../../shared/use-copy-feedback'
import { Button, CodeBlock, Collapsible, Icon, Stack, MetadataList, MetadataListItem, Text } from '@astryxdesign/core'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentItem, AgentRun } from '../../domain/chat/chat.types'

function AgentTimelineItemView({ item, run }: { item: AgentItem; run?: AgentRun }) {
  const { t, i18n } = useTranslation(), content = item.content
  const [reasoningOpen, setReasoningOpen] = useState<boolean>()
  if (content.type === 'user_message') return <ChatMessage sender="user" className="agent-message"><ChatMessageBubble><span className="agent-user-text">{content.text}</span></ChatMessageBubble></ChatMessage>
  if (content.type === 'assistant_message') return <ChatMessage sender="assistant" className="agent-message"><UntrustedProse text={content.text} /></ChatMessage>
  if (content.type === 'reasoning') {
    const kind = content.reasoning?.kind
    const title = kind === 'summary' ? t($ => $.ask.summary) : kind === 'encrypted' ? t($ => $.ask.encryptedReasoning) : t($ => $.ask.reasoning)
    const state = t($ => $.ask.itemStates[item.state])
    return <Collapsible trigger={`${title} · ${state}`} isOpen={reasoningOpen ?? item.state === 'streaming'} onOpenChange={setReasoningOpen} chevronPosition="start">
      <MetadataList>{([
        ...(content.reasoning ? [{ label: t($ => $.ask.source), value: content.reasoning.source }] : []),
        { label: t($ => $.ask.elapsed), value: t($ => $.ask.duration, { seconds: Math.max(0, (Date.parse(item.updatedAt) - Date.parse(item.createdAt)) / 1000).toFixed(1) }) }
      ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
      {kind === 'encrypted' ? <Text as="p" type="supporting" role="status">{t($ => $.ask.encryptedUnavailable)}</Text>
        : <TraceCode code={content.text} title={title} isWrapped />}
    </Collapsible>
  }
  if (content.type !== 'tool_call') return null
  const action = t($ => $.ask.tools[content.display.key])
  const description = item.state === 'uncertain' ? t($ => $.ask.uncertain) : content.display.count !== undefined ? t($ => $.ask.count, { count: content.display.count })
    : content.display.status ? t($ => $.ask.status, { status: t($ => $.jobs.statuses[content.display.status as keyof typeof $.jobs.statuses]) }) : content.display.startsAt ? t($ => $.ask.scheduled, { date: new Date(content.display.startsAt).toLocaleString(i18n.language) }) : undefined
  const label = content.guard?.executed === false ? `${action} · ${t($ => $.ask.guard.notExecuted)}` : item.state === 'running' ? t($ => $.ask.toolRunning, { action }) : item.state === 'failed' || item.state === 'uncertain' ? t($ => $.ask.toolFailed, { action })
    : item.state === 'cancelled' || item.state === 'interrupted' ? `${action} · ${t($ => $.ask.itemStates[item.state])}` : action
  return <Stack direction="horizontal" align="start" gap={2} className="agent-activity">
    <Icon size="sm" icon={item.state === 'completed' ? 'check' : item.state === 'running' ? 'clock' : 'error'} />
    <Stack gap={1} className="agent-activity-body">
      <Text>{label}</Text>{description && <Text type="supporting">{description}</Text>}
    <Collapsible trigger={t($ => $.ask.details)} defaultIsOpen={false} chevronPosition="start">
      <MetadataList>{([
        { label: t($ => $.ask.guard.runId), value: item.runId },
        ...(run ? [{ label: t($ => $.ask.guard.runState), value: t($ => $.ask.itemStates[run.state]) }] : []),
        { label: t($ => $.ask.toolName), value: content.toolName },
        ...(content.callId ? [{ label: t($ => $.ask.callId), value: content.callId }] : []),
        { label: t($ => $.ask.executionState), value: t($ => $.ask.itemStates[item.state]) },
        ...(content.durationMs !== undefined ? [{ label: t($ => $.ask.elapsed), value: t($ => $.ask.duration, { seconds: (content.durationMs / 1000).toFixed(1) }) }] : [])
      ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
      {content.guard && <MetadataList>{([
        { label: t($ => $.ask.guard.executionId), value: content.guard.executionRunId },
        { label: t($ => $.ask.guard.status), value: t($ => $.ask.guard[content.guard!.status === 'BLOCKED' ? 'blocked' : 'active']) },
        { label: t($ => $.ask.guard.calls), value: String(content.guard.calls) },
        { label: t($ => $.ask.guard.executedCalls), value: String(content.guard.executedCalls) },
        { label: t($ => $.ask.guard.rejections), value: String(content.guard.rejections) },
        { label: t($ => $.ask.guard.noProgress), value: String(content.guard.noProgress) },
        ...(content.guard.level ? [{ label: t($ => $.ask.guard.level), value: t($ => $.ask.guard[content.guard!.level!]) },
          { label: t($ => $.ask.guard.nextAction), value: t($ => $.ask.guard.changeStrategy) }] : []),
        ...(content.guard.reason ? [{ label: t($ => $.ask.guard.reason), value: t($ => $.ask.guard.reasons[content.guard!.reason!]) }] : []),
        ...content.guard.effects.map(effect => ({ label: t($ => $.ask.guard.confirmedEffect), value: `${effect.id} · ${t($ => $.ask.guard[effect.archived ? 'archived' : 'restored'])}` }))
      ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}
      {content.arguments !== undefined && <TraceCode title={t($ => $.ask.arguments)} code={JSON.stringify(content.arguments, null, 2)} />}
      {content.result !== undefined && <TraceCode title={t($ => $.ask.result)} code={JSON.stringify(content.result, null, 2)} />}
      {content.error && <TraceCode title={t($ => $.ask.toolError)} code={content.error} isWrapped />}
    </Collapsible>
  </Stack></Stack>
}

export const AgentTimelineItem = memo(AgentTimelineItemView)

function TraceCode({ code, title, isWrapped }: { code: string; title: string; isWrapped?: boolean }) {
  const { t } = useTranslation()
  const clipboard = useCopyFeedback(code)
  return <CodeBlock code={code} title={title} isWrapped={isWrapped} hasLanguageLabel={false} hasCopyButton={false} width="100%"
    endContent={<Button size="sm" variant="ghost" label={t($ => clipboard.copied ? $.ask.copied : $.ask.copyContent)}
      isDisabled={clipboard.copying || clipboard.copied} aria-live="polite" aria-busy={clipboard.copying}
      onClick={() => void clipboard.copy(async () => { await navigator.clipboard.writeText(code); return true })} />} />
}
