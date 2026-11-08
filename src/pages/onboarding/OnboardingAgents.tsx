import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
import { ActionRow, Button, Checkbox, CopyButton, Dialog, QuietPanel, StatusMessage } from '../../shared/ui'
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
      return <QuietPanel key={id}>
        <div className="onboarding-agent-label"><Checkbox disabled={s.busy} label={id === 'other' ? t($ => $.externalMCP.other) : agentNames[id as ExternalMCPTarget]}
          checked={selected} onChange={event => s.setSelected(current => event.target.checked ? [...current, id] : current.filter(target => target !== id))} />
          <span>{s.verified.includes(id) ? t($ => $.onboarding.verified) : status ? t($ => $.externalMCP.states[status.state]) : t($ => $.onboarding.notConfigured)}</span>
        </div>
        {selected && <div className="onboarding-agent-tools"><ActionRow align="start">
          {id === 'other' ? <><CopyButton size="sm" disabled={s.busy} onCopy={copyMCP} copyLabel={t($ => $.onboarding.copyMCP)} copiedLabel={t($ => $.externalMCP.copied)} />
            <CopyButton size="sm" disabled={s.busy} onCopy={copySkills} copyLabel={t($ => $.onboarding.copySkills)} copiedLabel={t($ => $.externalMCP.copied)} /></>
            : <><Button size="sm" disabled={s.busy || !status || Boolean(status.error)} onClick={() => status && void s.connect(status)}>{status?.state === 'configured' ? t($ => $.externalMCP.reconnect) : t($ => $.onboarding.installMCP)}</Button>
              <Button size="sm" disabled={s.busy || !skill || Boolean(skill.error)} onClick={() => skill && s.skills.requestInstall(skill, installed ? 'reconnect' : 'install')}>{installed ? t($ => $.externalSkills.update) : t($ => $.externalSkills.install)}</Button>
              {installed && <StatusMessage tone="success">{t($ => $.externalSkills.installed)}</StatusMessage>}</>}
        </ActionRow>
          {s.verified.includes(id) && <StatusMessage>{t($ => $.externalSkills.reconnectHelp)}</StatusMessage>}
          {id !== 'other' && s.skills.outcomes[id as ExternalMCPTarget]?.error && <StatusMessage tone="error">{t($ => $.externalSkills.errors[s.skills.outcomes[id as ExternalMCPTarget]!.error!])}</StatusMessage>}
        </div>}
      </QuietPanel>
    })}
    {s.error && <StatusMessage tone="error">{s.error}</StatusMessage>}
    {s.skills.error && <><StatusMessage tone="error">{t($ => $.externalSkills.errors[s.skills.error!])}</StatusMessage><Button disabled={s.busy} onClick={() => void s.skills.refresh()}>{t($ => $.settings.retry)}</Button></>}
    {s.skills.openError && <StatusMessage tone="error">{t($ => $.externalSkills.errors[s.skills.openError!])}</StatusMessage>}
    {!s.inspection && <Button disabled={s.busy} onClick={() => void s.refresh().catch(() => s.setError(t($ => $.settings.loadFailed)))}>{t($ => $.settings.retry)}</Button>}
    <Dialog open={Boolean(s.confirm)} title={t($ => $.externalMCP.replaceTitle)} description={t($ => $.externalMCP.replaceHelp, { agent: s.confirm ? agentNames[s.confirm.target] : '' })} onClose={() => s.setConfirm(null)}>
      <Button autoFocus onClick={() => s.setConfirm(null)}>{t($ => $.settings.cancel)}</Button>
      <Button variant="danger" onClick={() => s.confirm && void s.connect(s.confirm, true)}>{t($ => $.externalMCP.confirmReplace)}</Button>
    </Dialog>
    <ExternalSkillsConfirmation skills={s.skills} />
  </div>
}
