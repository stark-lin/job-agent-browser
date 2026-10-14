import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormField, PageHeading, SectionCard, Select, StatusMessage, TextArea } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { useChat } from './useChat'
import './ai.css'

export function AskAIPage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), chat = useChat(), end = useRef<HTMLDivElement>(null)
  const provider = chat.config?.providers.find(p => p.id === chat.choice?.providerId)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [chat.turns])
  return <main className="ai-page"><div className="ai-content">
    <div className="ai-actions"><Button variant="ghost" onClick={() => void openPage('home')}>{t($ => $.navigation.goHome)}</Button><Button disabled={chat.busy || !chat.turns.length} onClick={chat.reset}>{t($ => $.ai.newChat)}</Button></div>
    <PageHeading title={t($ => $.navigation.pages.ai)} description={t($ => $.ai.subtitle)} />
    {chat.loading ? <StatusMessage>{t($ => $.settings.loading)}</StatusMessage> : <>
      <div className="ai-selectors">
        <FormField label={t($ => $.settings.provider)}>{props => <Select {...props} value={provider?.id ?? ''} disabled={chat.busy} onChange={event => {
          const next = chat.config?.providers.find(p => p.id === event.target.value)
          chat.setChoice(next ? { providerId: next.id, modelId: next.defaultModel || next.models[0] || '' } : null)
        }}><option value="">{t($ => $.ai.selectProvider)}</option>{chat.config?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</FormField>
        <FormField label={t($ => $.ai.model)}>{props => <Select {...props} value={chat.choice?.modelId ?? ''} disabled={chat.busy || !provider} onChange={event => chat.setChoice(provider ? { providerId: provider.id, modelId: event.target.value } : null)}>
          <option value="">{t($ => $.settings.none)}</option>{provider?.models.map(model => <option key={model} value={model}>{model}</option>)}
        </Select>}</FormField>
      </div>
      {(!provider || !chat.choice?.modelId) && <div className="ai-actions"><StatusMessage>{t($ => $.ai.configure)}</StatusMessage><Button onClick={() => void openPage('settings')}>{t($ => $.navigation.openSettings)}</Button></div>}
      <div className="ai-transcript" role="log" aria-label={t($ => $.ai.conversation)} aria-live="polite" aria-relevant="additions text">
        {!chat.turns.length && <StatusMessage>{t($ => $.ai.empty)}</StatusMessage>}
        {chat.turns.map(turn => <SectionCard key={turn.id} title={turn.role === 'user' ? t($ => $.ai.you) : t($ => $.ai.assistant)} description={turn.role === 'assistant' ? `${turn.provider ?? ''} · ${turn.model ?? ''}` : undefined}>
          <div className="ai-message">{turn.content || (turn.state === 'streaming' ? t($ => $.ai.waiting) : '')}</div>
          {turn.state === 'cancelled' && <StatusMessage>{t($ => $.ai.cancelled)}</StatusMessage>}
        </SectionCard>)}<div ref={end} />
      </div>
      {chat.error && <StatusMessage tone="error">{t($ => $.ai.errors[chat.error!])}</StatusMessage>}
      <form className="ai-composer" onSubmit={event => { event.preventDefault(); void chat.send() }}>
        <FormField label={t($ => $.ai.message)}>{props => <TextArea {...props} value={chat.text} maxLength={128000} disabled={chat.busy} onChange={event => chat.setText(event.target.value)} />}</FormField>
        <div className="ai-actions"><StatusMessage>{t($ => $.ai.memoryOnly)}</StatusMessage><div className="ai-buttons">
          {chat.busy ? <Button onClick={chat.stop}>{t($ => $.ai.stop)}</Button> : <>
            {(chat.error || chat.turns.at(-1)?.state === 'cancelled') && chat.turns.length > 0 && <Button disabled={!chat.choice?.modelId} onClick={() => void chat.send(true)}>{t($ => $.ai.retry)}</Button>}
            <Button variant="primary" type="submit" disabled={!chat.text.trim() || !chat.choice?.modelId}>{t($ => $.ai.send)}</Button>
          </>}
        </div></div>
      </form>
    </>}
  </div></main>
}
