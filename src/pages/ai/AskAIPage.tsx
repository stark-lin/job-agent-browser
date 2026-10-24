import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Drawer, StatusMessage } from '../../shared/ui'
import { useNavigation } from '../../app/navigation/navigate'
import { useAskAgent } from './useAskAgent'
import { SessionSidebar } from './SessionSidebar'
import { ConversationTimeline } from './ConversationTimeline'
import { Composer } from './Composer'
import './ai.css'
export function AskAIPage() {
  const { t } = useTranslation(), { openPage } = useNavigation(), chat = useAskAgent(), [drawer, setDrawer] = useState(false)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 959px)').matches)
  useEffect(() => { const media = matchMedia('(max-width: 959px)'), change = () => { setNarrow(media.matches); setDrawer(false) }; media.addEventListener('change', change); return () => media.removeEventListener('change', change) }, [])
  const running = new Set(Object.entries(chat.state.runs).filter(([, runs]) => runs.some(r => r.state === 'running')).map(([id]) => id))
  const sidebar = <SessionSidebar sessions={chat.state.sessions} total={chat.state.total} activeId={chat.id} running={running} select={id => { chat.ask.select(id); setDrawer(false) }} more={() => void chat.ask.refreshSessions(true)} rename={(id, title) => chat.ask.rename(id, title)} remove={id => chat.ask.remove(id)} />
  const error = chat.state.error, knownError = error && Object.hasOwn(t($ => $.ask.errors, { returnObjects: true }), error)
  return <main className="ai-page">
    {narrow ? <Drawer open={drawer} title={t($ => $.ask.sessions)} closeLabel={t($ => $.ask.close)} onClose={() => setDrawer(false)}>{sidebar}</Drawer> : <aside className="ai-session-sidebar">{sidebar}</aside>}
    <section className={`ai-conversation${!chat.id ? ' ai-conversation--empty' : ''}`} aria-label={t($ => $.ask.conversation)}>
      {narrow && <div className="ai-session-toggle"><Button variant="ghost" aria-label={t($ => $.ask.openSessions)} aria-expanded={drawer} onClick={() => setDrawer(true)}>☰</Button></div>}
      {chat.state.loading ? <StatusMessage>{t($ => $.app.loadingWorkspace)}</StatusMessage> : !chat.id ? <div className="ai-empty"><h1>{t($ => $.ask.empty)}</h1><p>{t($ => $.ask.emptyHint)}</p></div> :
        <ConversationTimeline key={chat.id} id={chat.id} items={chat.items} runs={chat.runs} total={chat.state.totals[chat.id]} retryEnabled={chat.valid && !chat.state.sending} positions={chat.ask.scroll} loadOlder={() => chat.ask.load(chat.id!, true)} retry={message => { if (chat.valid && chat.choice) void chat.ask.send(chat.choice, message) }} />}
      <div className="ai-composer-dock">
        {error && <StatusMessage tone="error">{knownError ? t($ => $.ask.errors[error as keyof typeof $.ask.errors]) : t($ => $.ask.errors.UNKNOWN)}</StatusMessage>}
        {!chat.valid && <div className="ai-configure"><StatusMessage>{t($ => $.ask.configure)}</StatusMessage><Button variant="ghost" onClick={() => void openPage('settings')}>{t($ => $.ask.settings)}</Button></div>}
        <Composer text={chat.text} setText={chat.ask.setDraft} busy={Boolean(chat.active)} sending={chat.state.sending} valid={chat.valid} choice={chat.choice} config={chat.config} onChoice={choice => void chat.ask.setChoice(choice)} send={() => { if (chat.choice) void chat.ask.send(chat.choice) }} stop={() => { if (chat.active) void chat.ask.stop(chat.active.id) }} />
      </div>
    </section>
  </main>
}
