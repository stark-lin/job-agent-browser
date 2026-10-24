import { useTranslation } from 'react-i18next'
import type { ExternalSkillName, ExternalSkillsOutcome, ExternalSkillsStatus } from '../../shared/external-skills'
import { Badge, Button, DetailsList, Dialog, StatusMessage } from '../../shared/ui'
import type { useExternalSkills } from './useExternalSkills'

type Skills = ReturnType<typeof useExternalSkills>
export function ExternalSkillsControls({ status, outcome, disabled, busy, onInstall, onReconnect, onRemove }: {
  status: ExternalSkillsStatus; outcome?: ExternalSkillsOutcome; disabled: boolean; busy: boolean; onInstall(): void
  onReconnect(): void; onRemove(names: ExternalSkillName[]): void
}) {
  const { t } = useTranslation()
  const installed = status.skills.every(skill => skill.state === 'installed')
  const different = status.skills.some(skill => skill.state === 'different')
  return <div data-agent-skills={status.target} className="settings-stack" aria-busy={busy}>
    <DetailsList items={[{ label: t($ => $.externalSkills.path), value: status.path }, ...status.skills.map(skill => ({
      label: skill.name, value: <div className="settings-buttons">
        <Badge tone={skill.state === 'installed' ? 'success' : skill.state === 'unavailable' ? 'error' : 'neutral'}>{t($ => $.externalSkills.states[skill.state])}</Badge>
        <Button data-skill-remove={skill.name} size="sm" variant="danger" disabled={disabled || skill.state === 'missing' || Boolean(status.error)}
          aria-label={t($ => $.externalSkills.removeOne, { name: skill.name })} onClick={() => onRemove([skill.name])}>{t($ => $.externalSkills.remove)}</Button>
      </div>
    }))]} />
    {status.error && <StatusMessage tone="error">{t($ => $.externalSkills.errors[status.error!])}</StatusMessage>}
    <div className="settings-buttons"><Button data-skills-install disabled={disabled || installed || Boolean(status.error)} onClick={onInstall}>
      {installed ? t($ => $.externalSkills.installed) : different ? t($ => $.externalSkills.update) : t($ => $.externalSkills.install)}
    </Button>
      <Button data-skills-reconnect disabled={disabled || Boolean(status.error) || status.skills.every(skill => skill.state === 'missing')} onClick={onReconnect}>{t($ => $.externalSkills.reconnect)}</Button>
      <Button data-skills-remove variant="danger" disabled={disabled || Boolean(status.error) || status.skills.every(skill => skill.state === 'missing')}
        onClick={() => onRemove(status.skills.filter(skill => skill.state !== 'missing').map(skill => skill.name))}>{t($ => $.externalSkills.removeAll)}</Button>
    </div>
    {busy && <StatusMessage>{t($ => $.externalSkills.working)}</StatusMessage>}
    <StatusMessage>{t($ => $.externalSkills.reconnectHelp)}</StatusMessage>
    {outcome?.error && <StatusMessage tone="error">{t($ => $.externalSkills.errors[outcome.error!])}</StatusMessage>}
    {outcome?.completed.length ? <StatusMessage>{t($ => outcome.operation === 'remove' ? $.externalSkills.removedItems : $.externalSkills.completed, { names: outcome.completed.join(', ') })}</StatusMessage> : null}
    {outcome?.pending.length ? <StatusMessage>{t($ => outcome.operation === 'remove' ? $.externalSkills.pendingRemoval : $.externalSkills.pending, { names: outcome.pending.join(', ') })}</StatusMessage> : null}
    {outcome && !outcome.error && outcome.pending.length === 0 && <StatusMessage tone="success">{t($ => outcome.operation === 'remove' ? $.externalSkills.removed : $.externalSkills.saved)}</StatusMessage>}
  </div>
}

export function ExternalSkillsBundle({ skills, disabled }: { skills: Skills; disabled: boolean }) {
  const { t } = useTranslation()
  return <div className="settings-stack">
    <StatusMessage>{t($ => $.externalSkills.otherHelp)}</StatusMessage>
    <div><Button data-skills-open disabled={disabled} onClick={() => void skills.openBundle()}>{t($ => $.externalSkills.open)}</Button></div>
    {skills.openError && <StatusMessage tone="error">{t($ => $.externalSkills.errors[skills.openError!])}</StatusMessage>}
    {skills.opened && <StatusMessage tone="success">{t($ => $.externalSkills.opened)}</StatusMessage>}
  </div>
}

export function ExternalSkillsConfirmation({ skills }: { skills: Skills }) {
  const { t } = useTranslation(), { confirm } = skills
  return <><Dialog open={Boolean(confirm)} title={t($ => $.externalSkills.replaceTitle)} description={t($ => $.externalSkills.replaceHelp)}
    onClose={() => skills.setConfirm(null)} content={confirm && <DetailsList items={[
      { label: t($ => $.externalSkills.path), value: confirm.path },
      { label: t($ => $.externalSkills.conflicts), value: confirm.skills.filter(skill => skill.state === 'different').map(skill => skill.name).join(', ') }
    ]} />}>
    <Button autoFocus onClick={() => skills.setConfirm(null)}>{t($ => $.settings.cancel)}</Button>
    <Button data-skills-confirm variant="danger" onClick={() => { if (confirm) void skills.mutate(confirm, skills.confirmOperation, true); skills.setConfirm(null) }}>{t($ => $.externalSkills.confirmReplace)}</Button>
  </Dialog>
    <Dialog open={Boolean(skills.removal)} title={t($ => $.externalSkills.removeTitle)} description={t($ => $.externalSkills.removeHelp)}
      onClose={() => skills.setRemoval(null)} content={skills.removal && <DetailsList items={[
        { label: t($ => $.externalSkills.path), value: skills.removal.status.path },
        { label: t($ => $.externalSkills.toRemove), value: skills.removal.names.join(', ') }
      ]} />}>
      <Button autoFocus onClick={() => skills.setRemoval(null)}>{t($ => $.settings.cancel)}</Button>
      <Button data-skills-remove-confirm variant="danger" onClick={() => {
        if (skills.removal) void skills.mutate(skills.removal.status, 'remove', false, skills.removal.names)
        skills.setRemoval(null)
      }}>{t($ => $.externalSkills.confirmRemove)}</Button>
    </Dialog></>
}
