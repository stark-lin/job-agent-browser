import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '../../shared/ui'
/** Shared human confirmation for every workspace sync entry point. */
export function RemoteSyncDialog({ remote, busy, onCancel, onConfirm }: {
  remote: string | null; busy: boolean; onCancel(): void; onConfirm(): void
}) {
  const { t } = useTranslation()
  return <Dialog open={remote !== null} title={t($ => $.knowledge.syncConsentTitle)}
    description={`${t($ => $.knowledge.syncConsentHelp)} ${remote ?? ''}`} onClose={onCancel}>
    <Button autoFocus onClick={onCancel}>{t($ => $.knowledge.cancel)}</Button>
    <Button variant="primary" disabled={busy} onClick={onConfirm}>{t($ => $.knowledge.confirm)}</Button>
  </Dialog>
}
