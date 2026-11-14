import { Button, Dialog, DialogHeader, Heading, MetadataList, MetadataListItem, Stack, StatusDot, Text } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import type { ExternalSkillName, ExternalSkillsOutcome, ExternalSkillsStatus } from '../../shared/external-skills'
import type { useExternalSkills } from './useExternalSkills'

type Skills = ReturnType<typeof useExternalSkills>
export function ExternalSkillsControls({ status, outcome, disabled, busy, onInstall, onReconnect, onRemove }: {
  status: ExternalSkillsStatus; outcome?: ExternalSkillsOutcome; disabled: boolean; busy: boolean; onInstall(): void
  onReconnect(): void; onRemove(names: ExternalSkillName[]): void
}) {
  const { t } = useTranslation()
  const installed = status.skills.every(skill => skill.state === 'installed')
  const different = status.skills.some(skill => skill.state === 'different')
  return <Stack data-agent-skills={status.target} gap={2} aria-busy={busy}>
    <Heading level={3}>{t($ => $.settings.skills)}</Heading>
    <MetadataList>
      <MetadataListItem label={t($ => $.externalSkills.path)}>{status.path}</MetadataListItem>
    </MetadataList>
    <Stack as="ul" className="settings-list" role="list" gap={1}>
      {status.skills.map(skill => {
        const state = t($ => $.externalSkills.states[skill.state])
        return <Stack as="li" key={skill.name} direction="horizontal" justify="between" align="center" gap={2} wrap="wrap">
          <Text type="supporting">{skill.name}</Text>
          <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
            <StatusDot aria-hidden="true" label={state}
              variant={skill.state === 'installed' ? 'success' : skill.state === 'unavailable' ? 'error' : skill.state === 'different' ? 'warning' : 'neutral'} />
            <Text type="supporting">{state}</Text>
            <Button data-skill-remove={skill.name} size="sm" variant="destructive"
              isDisabled={disabled || skill.state === 'missing' || Boolean(status.error)}
              aria-label={t($ => $.externalSkills.removeOne, { name: skill.name })}
              onClick={() => onRemove([skill.name])} label={t($ => $.externalSkills.remove)} />
          </Stack>
        </Stack>
      })}
    </Stack>
    {status.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[status.error!])}</Text>}
    <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
      <Button data-skills-install isDisabled={disabled || installed || Boolean(status.error)} onClick={onInstall} label={installed ? t($ => $.externalSkills.installed) : different ? t($ => $.externalSkills.update) : t($ => $.externalSkills.install)} />
      <Button data-skills-reconnect isDisabled={disabled || Boolean(status.error) || status.skills.every(skill => skill.state === 'missing')} onClick={onReconnect} label={t($ => $.externalSkills.reconnect)} />
      <Button data-skills-remove variant="destructive" isDisabled={disabled || Boolean(status.error) || status.skills.every(skill => skill.state === 'missing')}
        onClick={() => onRemove(status.skills.filter(skill => skill.state !== 'missing').map(skill => skill.name))} label={t($ => $.externalSkills.removeAll)} />
    </Stack>
    {busy && <Text as="p" type="supporting" role="status">{t($ => $.externalSkills.working)}</Text>}
    {outcome?.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[outcome.error!])}</Text>}
    {outcome?.completed.length ? <Text as="p" type="supporting" role="status">{t($ => outcome.operation === 'remove' ? $.externalSkills.removedItems : $.externalSkills.completed, { names: outcome.completed.join(', ') })}</Text> : null}
    {outcome?.pending.length ? <Text as="p" type="supporting" role="status">{t($ => outcome.operation === 'remove' ? $.externalSkills.pendingRemoval : $.externalSkills.pending, { names: outcome.pending.join(', ') })}</Text> : null}
    {outcome && !outcome.error && outcome.pending.length === 0 && <Text as="p" type="supporting" role="status" className="success-message">{t($ => outcome.operation === 'remove' ? $.externalSkills.removed : $.externalSkills.saved)}</Text>}
  </Stack>
}

export function ExternalSkillsBundle({ skills, disabled }: { skills: Skills; disabled: boolean }) {
  const { t } = useTranslation()
  return <Stack gap={2}>
    <Stack direction="horizontal" justify="between" align="center" gap={2} wrap="wrap">
      <Text>{t($ => $.settings.skillsBundle)}</Text>
      <Button data-skills-open variant="ghost" isDisabled={disabled} onClick={() => void skills.openBundle()}
        label={t($ => $.settings.open)} aria-label={t($ => $.externalSkills.open)} />
    </Stack>
    {skills.openError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[skills.openError!])}</Text>}
    {skills.opened && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalSkills.opened)}</Text>}
  </Stack>
}

export function ExternalSkillsConfirmation({ skills }: { skills: Skills }) {
  const { t } = useTranslation(), { confirm } = skills
  return <><Dialog isOpen={Boolean(confirm)} onOpenChange={() => skills.setConfirm(null)} aria-label={t($ => $.externalSkills.replaceTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalSkills.replaceTitle)} subtitle={t($ => $.externalSkills.replaceHelp)} />
      <div className="dialog-content">{confirm && <MetadataList>{([
      { label: t($ => $.externalSkills.path), value: confirm.path },
      { label: t($ => $.externalSkills.conflicts), value: confirm.skills.filter(skill => skill.state === 'different').map(skill => skill.name).join(', ') }
    ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
    <Button data-autofocus="true" onClick={() => skills.setConfirm(null)} label={t($ => $.settings.cancel)} />
    <Button data-skills-confirm variant="destructive" onClick={() => { if (confirm) void skills.mutate(confirm, skills.confirmOperation, true); skills.setConfirm(null) }} label={t($ => $.externalSkills.confirmReplace)} />
  </Stack>
    </Dialog>
    <Dialog isOpen={Boolean(skills.removal)} onOpenChange={() => skills.setRemoval(null)} aria-label={t($ => $.externalSkills.removeTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalSkills.removeTitle)} subtitle={t($ => $.externalSkills.removeHelp)} />
      <div className="dialog-content">{skills.removal && <MetadataList>{([
        { label: t($ => $.externalSkills.path), value: skills.removal.status.path },
        { label: t($ => $.externalSkills.toRemove), value: skills.removal.names.join(', ') }
      ]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => skills.setRemoval(null)} label={t($ => $.settings.cancel)} />
      <Button data-skills-remove-confirm variant="destructive" onClick={() => {
        if (skills.removal) void skills.mutate(skills.removal.status, 'remove', false, skills.removal.names)
        skills.setRemoval(null)
      }} label={t($ => $.externalSkills.confirmRemove)} />
    </Stack>
    </Dialog></>
}
