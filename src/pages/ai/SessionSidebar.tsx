import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormField, SessionEntry, StatusMessage, TextInput } from '../../shared/ui'
import type { ChatSession } from '../../domain/chat/chat.types'
export function SessionSidebar({ sessions, total, activeId, running, select, more, rename, remove }: {
  sessions: ChatSession[]; total: number; activeId: string | null; running: Set<string>; select(id: string | null): void
  more(): void; rename(id: string, title: string): Promise<void>; remove(id: string): Promise<void>
}) {
  const { t } = useTranslation(), [selected, setSelected] = useState<ChatSession | null>(null), [mode, setMode] = useState<'actions' | 'rename' | 'delete'>('actions'), [title, setTitle] = useState(''), [busy, setBusy] = useState(false)
  const close = () => { if (!busy) setSelected(null) }
  return <div className="ai-session-content"><Button onClick={() => select(null)}>{t($ => $.ask.newChat)}</Button>
    <nav className="ai-session-list" aria-label={t($ => $.ask.sessions)}>{sessions.map(session => <SessionEntry key={session.id} title={session.title} selected={session.id === activeId} running={running.has(session.id)} runningLabel={t($ => $.ask.running)} moreLabel={t($ => $.ask.more, { title: session.title })} onSelect={() => select(session.id)} onMore={() => { setSelected(session); setTitle(session.title); setMode('actions') }} />)}</nav>
    {!sessions.length && <StatusMessage>{t($ => $.ask.noSessions)}</StatusMessage>}
    {sessions.length < total && <Button variant="ghost" onClick={more}>{t($ => $.ask.moreSessions)}</Button>}
    <Dialog open={Boolean(selected)} title={t($ => mode === 'rename' ? $.ask.rename : mode === 'delete' ? $.ask.delete : $.ask.actions)} description={mode === 'delete' ? t($ => $.ask.deleteDescription) : selected?.title ?? ''} onClose={close}
      content={mode === 'rename' ? <FormField label={t($ => $.ask.title)}>{props => <TextInput {...props} autoFocus value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />}</FormField> : mode === 'actions' && selected && running.has(selected.id) ? <StatusMessage>{t($ => $.ask.stopBeforeDelete)}</StatusMessage> : undefined}>
      {mode === 'actions' ? <><Button onClick={() => setMode('rename')}>{t($ => $.ask.rename)}</Button><Button variant="danger" disabled={Boolean(selected && running.has(selected.id))} onClick={() => setMode('delete')}>{t($ => $.ask.delete)}</Button></>
        : <Button variant={mode === 'delete' ? 'danger' : 'primary'} disabled={busy || mode === 'rename' && !title.trim()} onClick={() => {
          if (!selected) return; setBusy(true)
          void (mode === 'delete' ? remove(selected.id) : rename(selected.id, title.trim())).finally(() => { setBusy(false); setSelected(null) })
        }}>{t($ => mode === 'delete' ? $.ask.delete : $.ask.save)}</Button>}
      <Button disabled={busy} onClick={close}>{t($ => $.ask.cancel)}</Button>
    </Dialog>
  </div>
}
