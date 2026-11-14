import { useCopyFeedback } from '../../shared/use-copy-feedback'
import { Button, Dialog, DialogHeader, Icon, IconButton, StatusDot, Stack, Text, TextInput } from '@astryxdesign/core'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [copyAttempt, setCopyAttempt] = useState(0)
  const clipboard = useCopyFeedback(copyAttempt)
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
  return <div className="ai-session-content"><Button onClick={() => select(null)} label={t($ => $.ask.newChat)} />
    <nav className="ai-session-list" aria-label={t($ => $.ask.sessions)}>{sessions.map(session => <Stack key={session.id} className="ai-session-entry" direction="horizontal" align="center" data-selected={String(session.id === activeId)}>
      <Button variant="ghost" aria-current={session.id === activeId ? 'page' : undefined} className="ai-session-select"
        label={session.title} onClick={() => select(session.id)} endContent={running.has(session.id) ? <StatusDot variant="accent" label={t($ => $.ask.running)} /> : undefined}>
        <span className="ai-session-title">{session.title}</span>
      </Button>
      <IconButton variant="ghost" size="sm" label={t($ => $.ask.more, { title: session.title })} icon={<Icon icon="moreHorizontal" />}
        onClick={() => { setSelected(session); setTitle(session.title); setMode('actions'); setError(null) }} />
    </Stack>)}</nav>
    {!sessions.length && <Text as="p" type="supporting" role="status">{t($ => $.ask.noSessions)}</Text>}
    {sessions.length < total && <Button variant="ghost" onClick={more} label={t($ => $.ask.moreSessions)} />}
    <Dialog key={mode} isOpen={Boolean(selected)} onOpenChange={() => close()} aria-label={t($ => mode === 'rename' ? $.ask.rename : mode === 'delete' ? $.ask.delete : mode === 'copy' ? $.ask.copyDebugTitle : $.ask.actions)} width={448} purpose="form">
      <DialogHeader title={t($ => mode === 'rename' ? $.ask.rename : mode === 'delete' ? $.ask.delete : mode === 'copy' ? $.ask.copyDebugTitle : $.ask.actions)} subtitle={mode === 'delete' ? t($ => $.ask.deleteDescription) : mode === 'copy' ? t($ => $.ask.copyDebugDescription) : selected?.title ?? ''} />
      <div className="dialog-content">{mode === 'rename' ? <TextInput label={t($ => $.ask.title)} hasAutoFocus value={title} ref={input => { if (input) { input.maxLength = 120 } }} onChange={e => setTitle(e)} /> : mode === 'copy' && error ? <Text as="p" type="supporting" role="alert" className="error-message">{knownError ? t($ => $.ask.errors[error as keyof typeof $.ask.errors]) : t($ => $.ask.errors.UNKNOWN)}</Text> : mode === 'actions' && selected && running.has(selected.id) ? <Text as="p" type="supporting" role="status">{t($ => $.ask.stopBeforeDelete)}</Text> : undefined}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      {mode === 'actions' ? <><Button onClick={() => setMode('rename')} label={t($ => $.ask.rename)} /><Button onClick={() => { setCopyAttempt(attempt => attempt + 1); setMode('copy') }} label={t($ => $.ask.copyDebugJson)} /><Button variant="destructive" isDisabled={Boolean(selected && running.has(selected.id))} onClick={() => setMode('delete')} label={t($ => $.ask.delete)} /></>
        : mode !== 'copy' && <Button variant={mode === 'delete' ? 'destructive' : 'primary'} isDisabled={busy || mode === 'rename' && !title.trim()} onClick={() => {
          if (!selected || pending.current) return; pending.current = true; setBusy(true)
          void (mode === 'delete' ? remove(selected.id) : rename(selected.id, title.trim())).finally(() => { pending.current = false; setBusy(false); setSelected(null) })
        }} label={t($ => mode === 'delete' ? $.ask.delete : $.ask.save)} />}
      <Button data-autofocus={mode === 'copy' ? 'true' : undefined} isDisabled={busy} onClick={close} label={t($ => $.ask.cancel)} />
      {mode === 'copy' && <Button variant="primary" label={clipboard.copied ? t($ => $.ask.debugCopied) : t($ => $.ask.copyJson)}
        isDisabled={busy || clipboard.copying || clipboard.copied} aria-busy={clipboard.copying} aria-live="polite" onClick={() => void clipboard.copy(copy)} />}
    </Stack>
    </Dialog>
  </div>
}
