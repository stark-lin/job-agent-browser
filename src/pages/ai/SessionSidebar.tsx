import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CopyButton, Dialog, FormField, SessionEntry, StatusMessage, TextInput } from '../../shared/ui'
import type { ChatSession } from '../../domain/chat/chat.types'
import type { ErrorCode } from '../../domain/common/errors'
import type { Result } from '../../shared/ipc'
export function SessionSidebar({ sessions, total, activeId, running, select, more, rename, remove, copyDebugJson }: {
  sessions: ChatSession[]; total: number; activeId: string | null; running: Set<string>; select(id: string | null): void
  more(): void; rename(id: string, title: string): Promise<void>; remove(id: string): Promise<void>
  copyDebugJson(sessionId: string): Promise<Result<null, ErrorCode>>
}) {
  const { t } = useTranslation(), [selected, setSelected] = useState<ChatSession | null>(null), [mode, setMode] = useState<'actions' | 'rename' | 'copy' | 'delete'>('actions'), [title, setTitle] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef(false), [error, setError] = useState<ErrorCode | null>(null)
  const close = () => { if (!pending.current) setSelected(null) }
  const copy = async () => {
    if (!selected || pending.current) return false
    const sessionId = selected.id
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await copyDebugJson(sessionId)
      if (result.ok) return true
      setError(result.error)
    } catch { setError('STORAGE_UNAVAILABLE') }
    finally { pending.current = false; setBusy(false) }
    return false
  }
  const knownError = error && Object.hasOwn(t($ => $.ask.errors, { returnObjects: true }), error)
  return <div className="ai-session-content"><Button onClick={() => select(null)}>{t($ => $.ask.newChat)}</Button>
    <nav className="ai-session-list" aria-label={t($ => $.ask.sessions)}>{sessions.map(session => <SessionEntry key={session.id} title={session.title} selected={session.id === activeId} running={running.has(session.id)} runningLabel={t($ => $.ask.running)} moreLabel={t($ => $.ask.more, { title: session.title })} onSelect={() => select(session.id)} onMore={() => { setSelected(session); setTitle(session.title); setMode('actions'); setError(null) }} />)}</nav>
    {!sessions.length && <StatusMessage>{t($ => $.ask.noSessions)}</StatusMessage>}
    {sessions.length < total && <Button variant="ghost" onClick={more}>{t($ => $.ask.moreSessions)}</Button>}
    <Dialog key={mode} open={Boolean(selected)} title={t($ => mode === 'rename' ? $.ask.rename : mode === 'delete' ? $.ask.delete : mode === 'copy' ? $.ask.copyDebugTitle : $.ask.actions)} description={mode === 'delete' ? t($ => $.ask.deleteDescription) : mode === 'copy' ? t($ => $.ask.copyDebugDescription) : selected?.title ?? ''} onClose={close}
      content={mode === 'rename' ? <FormField label={t($ => $.ask.title)}>{props => <TextInput {...props} autoFocus value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />}</FormField> : mode === 'copy' && error ? <StatusMessage tone="error">{knownError ? t($ => $.ask.errors[error as keyof typeof $.ask.errors]) : t($ => $.ask.errors.UNKNOWN)}</StatusMessage> : mode === 'actions' && selected && running.has(selected.id) ? <StatusMessage>{t($ => $.ask.stopBeforeDelete)}</StatusMessage> : undefined}>
      {mode === 'actions' ? <><Button onClick={() => setMode('rename')}>{t($ => $.ask.rename)}</Button><Button onClick={() => setMode('copy')}>{t($ => $.ask.copyDebugJson)}</Button><Button variant="danger" disabled={Boolean(selected && running.has(selected.id))} onClick={() => setMode('delete')}>{t($ => $.ask.delete)}</Button></>
        : mode !== 'copy' && <Button variant={mode === 'delete' ? 'danger' : 'primary'} disabled={busy || mode === 'rename' && !title.trim()} onClick={() => {
          if (!selected || pending.current) return; pending.current = true; setBusy(true)
          void (mode === 'delete' ? remove(selected.id) : rename(selected.id, title.trim())).finally(() => { pending.current = false; setBusy(false); setSelected(null) })
        }}>{t($ => mode === 'delete' ? $.ask.delete : $.ask.save)}</Button>}
      <Button autoFocus={mode === 'copy'} disabled={busy} onClick={close}>{t($ => $.ask.cancel)}</Button>
      {mode === 'copy' && <CopyButton variant="primary" disabled={busy} onCopy={copy} copyLabel={t($ => $.ask.copyJson)} copiedLabel={t($ => $.ask.debugCopied)} />}
    </Dialog>
  </div>
}
