import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemInput } from '../../domain/candidate/candidate.types'
import { ActionRow, Button, DetailsList, Dialog, SectionCard, StatusMessage } from '../../shared/ui'
import './editor.css'

export function EditorDialog({ open, title, disabled, invalid, children, onClose, onSave }: {
  open: boolean; title?: string; disabled: boolean; invalid?: boolean; children: ReactNode; onClose(): void; onSave(): void
}) {
  const { t } = useTranslation(), form = useId()
  return <Dialog open={open} title={title ?? t($ => $.profile.edit)} onClose={onClose} content={
    <form id={form} className="profile-stack" onSubmit={event => { event.preventDefault(); onSave() }}>
      {children}
      {invalid && <StatusMessage tone="error">{t($ => $.profile.invalid)}</StatusMessage>}
    </form>
  }>
    <Button disabled={disabled} onClick={onClose}>{t($ => $.profile.cancel)}</Button>
    <Button form={form} type="submit" variant="primary" disabled={disabled}>{t($ => $.profile.save)}</Button>
  </Dialog>
}

export function ItemCard({ value, disabled, onEdit, onRemove, children }: {
  value: ItemInput; disabled: boolean; onEdit(): void; onRemove?: () => void; children: ReactNode
}) {
  const { t } = useTranslation(), metadata = value.metadata ?? {}
  return <SectionCard title={value.title.trim() || t($ => $.profile.types[value.type])} description={[value.organization, value.role].filter(Boolean).join(' · ')}><div className="profile-stack">
    <DetailsList items={[
      { label: t($ => $.profile.startDate), value: metadata.startDateText || value.startDate || '—' },
      { label: t($ => $.profile.endDate), value: metadata.isCurrent ? t($ => $.profile.current) : metadata.endDateText || value.endDate || '—' },
      ...(['location', 'summary'] as const).filter(key => value[key]).map(key => ({ label: t($ => $.profile[key]), value: value[key] })),
      ...(['degree', 'major', 'gpa', 'employmentType', 'url'] as const).filter(key => metadata[key]).map(key => ({ label: t($ => $.profile[key]), value: metadata[key] })),
      ...(metadata.technologies?.length ? [{ label: t($ => $.profile.technologies), value: metadata.technologies.join(', ') }] : [])
    ]} />
    <ActionRow><Button disabled={disabled} onClick={onEdit}>{t($ => $.profile.edit)}</Button>
      {onRemove && <Button variant="danger" disabled={disabled} onClick={onRemove}>{t($ => $.profile.remove)}</Button>}</ActionRow>
    {children}
  </div></SectionCard>
}
