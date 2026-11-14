import { Button, Drawer, EmptyState, Icon, IconButton, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import { useAskAgent } from './useAskAgent'
import { SessionSidebar } from './SessionSidebar'
import { ConversationTimeline } from './ConversationTimeline'
import { Composer } from './Composer'
import { useWebSelection } from '../../app/navigation/useWebSelection'
import './ai.css'
export function AskAIPage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), chat = useAskAgent(), { data } = useServices(), [drawer, setDrawer] = useState(false)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 959px)').matches)
  const selection = useWebSelection('ask-ai', chat.ask.insertWebSelection)
  useEffect(() => { const media = matchMedia('(max-width: 959px)'), change = () => { setNarrow(media.matches); setDrawer(false) }; media.addEventListener('change', change); return () => media.removeEventListener('change', change) }, [])
  const running = new Set(Object.entries(chat.state.runs).filter(([, runs]) => runs.some(r => r.state === 'running')).map(([id]) => id))
  const sidebar = <SessionSidebar sessions={chat.state.sessions} total={chat.state.total} activeId={chat.id} running={running} select={id => { chat.ask.select(id); setDrawer(false) }} more={() => void chat.ask.refreshSessions(true)} rename={(id, title) => chat.ask.rename(id, title)} copyDebugJson={sessionId => data.chats.copyDebugJson({ sessionId })} remove={id => chat.ask.remove(id)} />
  const error = chat.state.error, knownError = error && Object.hasOwn(t($ => $.ask.errors, { returnObjects: true }), error)
  const runtime = chat.active ?? [...chat.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], status = runtime?.runtimeStatus
  const runtimeKeys = { pending: 'pending', 'context.compacting': 'compacting', 'human.waiting': 'humanWaiting', 'tools.searching': 'searching', 'tools.activating': 'activating' } as const
  return <main className="ai-page">
    {narrow ? <Drawer className="ai-session-drawer" isOpen={drawer} label={t($ => $.ask.sessions)} onOpenChange={setDrawer} side="start">
      <Stack className="ai-session-drawer-heading" direction="horizontal" justify="between" align="center">
        <h2>{t($ => $.ask.sessions)}</h2><IconButton label={t($ => $.ask.close)} icon={<Icon icon="close" />} variant="ghost" onClick={() => setDrawer(false)} />
      </Stack>{sidebar}
    </Drawer> : <aside className="ai-session-sidebar">{sidebar}</aside>}
    <section className={`ai-conversation${!chat.id ? ' ai-conversation--empty' : ''}`} aria-label={t($ => $.ask.conversation)}>
      {narrow && <div className="ai-session-toggle"><Button variant="ghost" aria-label={t($ => $.ask.openSessions)} aria-expanded={drawer} onClick={() => setDrawer(true)} label={t($ => $.ask.openSessions)}>☰</Button></div>}
      {chat.state.loading ? <Text as="p" type="supporting" role="status">{t($ => $.app.loadingWorkspace)}</Text> : !chat.id ? <EmptyState className="ai-empty" headingLevel={1} title={t($ => $.ask.empty)} description={t($ => $.ask.emptyHint)} /> :
        <ConversationTimeline key={chat.id} id={chat.id} items={chat.items} runs={chat.runs} total={chat.state.totals[chat.id]} retryEnabled={chat.valid && !chat.state.sending} positions={chat.ask.scroll} loadOlder={() => chat.ask.load(chat.id!, true)} retry={message => { if (chat.valid && chat.choice) void chat.ask.send(chat.choice, message) }} />}
      <div className="ai-composer-dock">
        {selection.error && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.selection[selection.error!])}</Text><Button onClick={selection.retry} label={t($ => $.selection.retry)} /></Stack>}
        {status && status !== 'idle' && <Text as="p" type="supporting" role="status">{t($ => $.ask.runtime[runtimeKeys[status]])}</Text>}
        {error && <Text as="p" type="supporting" role="alert" className="error-message">{knownError ? t($ => $.ask.errors[error as keyof typeof $.ask.errors]) : t($ => $.ask.errors.UNKNOWN)}</Text>}
        {!chat.valid && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Text as="p" type="supporting" role="status">{t($ => $.ask.configure)}</Text><Button variant="ghost" onClick={() => void openPage('settings')} label={t($ => $.ask.settings)} /></Stack>}
        <Composer text={chat.text} setText={chat.ask.setDraft} busy={Boolean(chat.active)} sending={chat.state.sending} valid={chat.valid} choice={chat.choice} config={chat.config} onChoice={choice => void chat.ask.setChoice(choice)} send={() => { if (chat.choice) void chat.ask.send(chat.choice) }} stop={() => { if (chat.active) void chat.ask.stop(chat.active.id) }} />
      </div>
    </section>
  </main>
}
