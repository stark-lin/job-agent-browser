import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, IconButton } from './Button'

export function ChatMessage({ user, children }: { user?: boolean; children: ReactNode }) {
  return <div className={`ui-chat-message${user ? ' ui-chat-message--user' : ''}`}>{children}</div>
}
export function Collapsible({ label, children, streaming = false }: { label: string; children: ReactNode; streaming?: boolean }) {
  const id = useId(), [open, setOpen] = useState(streaming), touched = useRef(false)
  useEffect(() => { if (!touched.current) setOpen(streaming) }, [streaming])
  return <div className="ui-collapsible"><Button variant="ghost" aria-expanded={open} aria-controls={id} onClick={() => { touched.current = true; setOpen(!open) }}><span aria-hidden="true">{open ? '⌄' : '›'}</span>{label}</Button>
    {open && <div id={id} className="ui-collapsible-content">{children}</div>}
  </div>
}
export function ActivityRow({ state, label, description, children }: { state: string; label: string; description?: string; children?: ReactNode }) {
  return <div className={`ui-activity ui-activity--${state}`}><span className="ui-activity-symbol" aria-hidden="true">{state === 'completed' ? '✓' : state === 'running' ? '◌' : '!'}</span>
    <div className="ui-activity-body"><div>{label}</div>{description && <div className="ui-activity-description">{description}</div>}{children}</div></div>
}
export function SessionEntry({ title, selected, running, onSelect, onMore, moreLabel, runningLabel }: {
  title: string; selected: boolean; running: boolean; onSelect(): void; onMore(): void; moreLabel: string; runningLabel: string
}) {
  return <div className={`ui-session-entry${selected ? ' ui-session-entry--selected' : ''}`}>
    <Button variant="ghost" aria-current={selected ? 'page' : undefined} className="ui-session-select" onClick={onSelect}><span className="ui-session-title">{title}</span>{running && <span aria-label={runningLabel}>●</span>}</Button>
    <IconButton aria-label={moreLabel} onClick={onMore}>···</IconButton>
  </div>
}
export function Drawer({ open, title, closeLabel, onClose, children }: { open: boolean; title: string; closeLabel: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); if (!open && ref.current?.open) ref.current?.close() }, [open])
  return <dialog ref={ref} className="ui-drawer" aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose() }}>
    <div className="ui-drawer-heading"><h2 id={id}>{title}</h2><IconButton aria-label={closeLabel} onClick={onClose}>×</IconButton></div>{children}
  </dialog>
}
export function ComposerSurface({ children, controls }: { children: ReactNode; controls: ReactNode }) {
  return <div className="ui-composer-surface">{children}<div className="ui-composer-controls">{controls}</div></div>
}
