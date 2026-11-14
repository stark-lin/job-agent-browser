import { useCopyFeedback } from '../../shared/use-copy-feedback'
import { Button, CheckboxInput, Dialog, DialogHeader, Section, Stack, Text } from '@astryxdesign/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
import { useExternalSkills } from '../settings/useExternalSkills'
import { ExternalSkillsConfirmation } from '../settings/ExternalSkillsSettings'

export const agentNames = { codex: 'Codex', 'claude-code': 'Claude Code', cursor: 'Cursor' }
export function useOnboardingAgents() {
  const { t } = useTranslation(), skills = useExternalSkills()
  const [inspection, setInspection] = useState<ExternalMCPInspection | null>(null), [selected, setSelected] = useState<string[]>(['codex'])
  const [verified, setVerified] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ExternalMCPStatus | null>(null), lock = useRef(false)
  async function refresh() {
    const result = await window.externalMCP.inspect({})
    if (!result.ok) throw new Error(t($ => $.externalMCP.errors[result.error]))
    setInspection(result.value)
  }
  useEffect(() => { void refresh().catch(() => setError(t($ => $.settings.loadFailed))) }, [])
  async function connect(status: ExternalMCPStatus, replace = false) {
    if (lock.current) return
    if (status.state === 'different' && !replace) { setConfirm(status); return }
    lock.current = true; setBusy(true); setError(''); setConfirm(null)
    try {
      if (status.state !== 'configured') {
        const result = await window.externalMCP.install({ target: status.target, revision: status.revision, replace })
        if (!result.ok) throw new Error(t($ => $.externalMCP.errors[result.error]))
      } else {
        const result = await window.externalMCP.reconnect({ target: status.target, revision: status.revision })
        if (!result.ok) throw new Error(t($ => $.externalMCP.errors[result.error]))
        if (result.value.error) throw new Error(t($ => $.externalMCP.errors[result.value.error!]))
      }
      // Installation and connection are distinct: only a real probe marks an agent verified.
      const probe = await window.externalMCP.test({ target: status.target })
      if (!probe.ok) throw new Error(t($ => $.externalMCP.errors[probe.error]))
      setVerified(current => [...new Set([...current, status.target])])
    } catch (reason) { setError(reason instanceof Error ? reason.message : t($ => $.settings.saveFailed)) }
    finally { await refresh().catch(() => setError(t($ => $.settings.loadFailed))); lock.current = false; setBusy(false) }
  }
  const ready = selected.some(id => id === 'other' || inspection?.clients.some(client => client.target === id && client.state === 'configured'))
  return { skills, inspection, selected, setSelected, verified, busy: busy || Boolean(skills.busy) || skills.loading, error, setError, confirm, setConfirm, connect, ready, refresh }
}
export function OnboardingAgents({ state: s }: { state: ReturnType<typeof useOnboardingAgents> }) {
  const { t } = useTranslation()
  const mcpClipboard = useCopyFeedback(), skillsClipboard = useCopyFeedback()
  async function copyMCP() {
    try {
      const result = await window.externalMCP.copy({ target: 'other' })
      if (!result.ok) { s.setError(t($ => $.externalMCP.errors[result.error])); return false }
      return true
    } catch { s.setError(t($ => $.externalMCP.errors.COPY_FAILED)); return false }
  }
  async function copySkills() {
    try { await navigator.clipboard.writeText(t($ => $.externalSkills.otherHelp)); return true }
    catch { s.setError(t($ => $.externalMCP.errors.COPY_FAILED)); return false }
  }
  return <div className="onboarding-stack">
    {[...Object.keys(agentNames), 'other'].map(id => {
      const selected = s.selected.includes(id), status = s.inspection?.clients.find(client => client.target === id)
      const skill = s.skills.inspection?.clients.find(client => client.target === id)
      const installed = skill?.skills.every(item => item.state === 'installed')
      return <Section key={id} variant="muted" padding={3}>
        <div className="onboarding-agent-label"><CheckboxInput isDisabled={s.busy} label={id === 'other' ? t($ => $.externalMCP.other) : agentNames[id as ExternalMCPTarget]}
          value={selected} onChange={event => s.setSelected(current => event ? [...current, id] : current.filter(target => target !== id))} />
          <span>{s.verified.includes(id) ? t($ => $.onboarding.verified) : status ? t($ => $.externalMCP.states[status.state]) : t($ => $.onboarding.notConfigured)}</span>
        </div>
        {selected && <div className="onboarding-agent-tools"><Stack  className="action-row" direction="horizontal" justify="start" align="center" gap={2} wrap="wrap">
          {id === 'other' ? <><Button size="sm" label={mcpClipboard.copied ? t($ => $.externalMCP.copied) : t($ => $.onboarding.copyMCP)}
        isDisabled={s.busy || mcpClipboard.copying || mcpClipboard.copied} aria-busy={mcpClipboard.copying} aria-live="polite" onClick={() => void mcpClipboard.copy(copyMCP)} />
            <Button size="sm" label={skillsClipboard.copied ? t($ => $.externalMCP.copied) : t($ => $.onboarding.copySkills)}
        isDisabled={s.busy || skillsClipboard.copying || skillsClipboard.copied} aria-busy={skillsClipboard.copying} aria-live="polite" onClick={() => void skillsClipboard.copy(copySkills)} /></>
            : <><Button size="sm" isDisabled={s.busy || !status || Boolean(status.error)} onClick={() => status && void s.connect(status)} label={status?.state === 'configured' ? t($ => $.externalMCP.reconnect) : t($ => $.onboarding.installMCP)} />
              <Button size="sm" isDisabled={s.busy || !skill || Boolean(skill.error)} onClick={() => skill && s.skills.requestInstall(skill, installed ? 'reconnect' : 'install')} label={installed ? t($ => $.externalSkills.update) : t($ => $.externalSkills.install)} />
              {installed && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalSkills.installed)}</Text>}</>}
        </Stack>
          {s.verified.includes(id) && <Text as="p" type="supporting" role="status">{t($ => $.externalSkills.reconnectHelp)}</Text>}
          {id !== 'other' && s.skills.outcomes[id as ExternalMCPTarget]?.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[s.skills.outcomes[id as ExternalMCPTarget]!.error!])}</Text>}
        </div>}
      </Section>
    })}
    {s.error && <Text as="p" type="supporting" role="alert" className="error-message">{s.error}</Text>}
    {s.skills.error && <><Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[s.skills.error!])}</Text><Button isDisabled={s.busy} onClick={() => void s.skills.refresh()} label={t($ => $.settings.retry)} /></>}
    {s.skills.openError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[s.skills.openError!])}</Text>}
    {!s.inspection && <Button isDisabled={s.busy} onClick={() => void s.refresh().catch(() => s.setError(t($ => $.settings.loadFailed)))} label={t($ => $.settings.retry)} />}
    <Dialog  isOpen={Boolean(s.confirm)} onOpenChange={() => s.setConfirm(null)} aria-label={t($ => $.externalMCP.replaceTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalMCP.replaceTitle)} subtitle={t($ => $.externalMCP.replaceHelp, { agent: s.confirm ? agentNames[s.confirm.target] : '' })} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => s.setConfirm(null)} label={t($ => $.settings.cancel)} />
      <Button variant="destructive" onClick={() => s.confirm && void s.connect(s.confirm, true)} label={t($ => $.externalMCP.confirmReplace)} />
    </Stack>
    </Dialog>
    <ExternalSkillsConfirmation skills={s.skills} />
  </div>
}
