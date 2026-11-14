import { Button, Dialog, DialogHeader, Stack } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'

/** Shared human confirmation for every workspace sync entry point. */
export function RemoteSyncDialog({ remote, busy, onCancel, onConfirm }: {
  remote: string | null; busy: boolean; onCancel(): void; onConfirm(): void
}) {
  const { t } = useTranslation()
  return <Dialog  isOpen={remote !== null} onOpenChange={() => onCancel()} aria-label={t($ => $.knowledge.syncConsentTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.knowledge.syncConsentTitle)} subtitle={`${t($ => $.knowledge.syncConsentHelp)} ${remote ?? ''}`} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
    <Button data-autofocus="true" onClick={onCancel} label={t($ => $.knowledge.cancel)} />
    <Button variant="primary" isDisabled={busy} onClick={onConfirm} label={t($ => $.knowledge.confirm)} />
  </Stack>
    </Dialog>
}
