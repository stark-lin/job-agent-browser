import { Button, Dialog, DialogHeader, Heading, MetadataList, MetadataListItem, Section, Stack, Text } from '@astryxdesign/core'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemInput } from '../../domain/candidate/candidate.types'
import './editor.css'

export function EditorDialog({ open, title, disabled, invalid, children, onClose, onSave }: {
  open: boolean; title?: string; disabled: boolean; invalid?: boolean; children: ReactNode; onClose(): void; onSave(): void
}) {
  const { t } = useTranslation(), form = useId()
  return <Dialog  isOpen={open} onOpenChange={() => onClose()} aria-label={title ?? t($ => $.profile.edit)} width={448} purpose="form">
      <DialogHeader title={title ?? t($ => $.profile.edit)} />
      <div className="dialog-content">{<form id={form} className="profile-stack" onSubmit={event => { event.preventDefault(); onSave() }}>
      {children}
      {invalid && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.profile.invalid)}</Text>}
    </form>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
    <Button isDisabled={disabled} onClick={onClose} label={t($ => $.profile.cancel)} />
    <Button form={form} type="submit" variant="primary" isDisabled={disabled} label={t($ => $.profile.save)} />
  </Stack>
    </Dialog>
}

export function ItemCard({ value, disabled, onEdit, onRemove, children }: {
  value: ItemInput; disabled: boolean; onEdit(): void; onRemove?: () => void; children: ReactNode
}) {
  const { t } = useTranslation(), metadata = value.metadata ?? {}
  return <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{value.title.trim() || t($ => $.profile.types[value.type])}</Heading></summary>
      <div className="feature-section-body">{[value.organization, value.role].filter(Boolean).join(' · ') && <p>{[value.organization, value.role].filter(Boolean).join(' · ')}</p>}<div className="profile-stack">
    <MetadataList>{([
      { label: t($ => $.profile.startDate), value: metadata.startDateText || value.startDate || '—' },
      { label: t($ => $.profile.endDate), value: metadata.isCurrent ? t($ => $.profile.current) : metadata.endDateText || value.endDate || '—' },
      ...(['location', 'summary'] as const).filter(key => value[key]).map(key => ({ label: t($ => $.profile[key]), value: value[key] })),
      ...(['degree', 'major', 'gpa', 'employmentType', 'url'] as const).filter(key => metadata[key]).map(key => ({ label: t($ => $.profile[key]), value: metadata[key] })),
      ...(metadata.technologies?.length ? [{ label: t($ => $.profile.technologies), value: metadata.technologies.join(', ') }] : [])
    ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
    <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button isDisabled={disabled} onClick={onEdit} label={t($ => $.profile.edit)} />
      {onRemove && <Button variant="destructive" isDisabled={disabled} onClick={onRemove} label={t($ => $.profile.remove)} />}</Stack>
    {children}
  </div></div></details></Section>
}
