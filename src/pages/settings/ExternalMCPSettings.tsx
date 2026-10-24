import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPError, ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
import { Badge, Button, DetailsList, Dialog, FormField, SectionCard, StatusMessage, TextArea } from '../../shared/ui'
import { useExternalSkills } from './useExternalSkills'
import { ExternalSkillsBundle, ExternalSkillsConfirmation, ExternalSkillsControls } from './ExternalSkillsSettings'

const names = { codex: 'Codex', 'claude-code': 'Claude Code', cursor: 'Cursor' }
type Feedback = { error?: ExternalMCPError; saved?: boolean; copied?: boolean; removed?: boolean; reconnected?: boolean; toolCount?: number; backupPath?: string }
export function ExternalMCPSettings() {
  const { t } = useTranslation()
  const skills = useExternalSkills()
  const [inspection, setInspection] = useState<ExternalMCPInspection | null>(null)
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<ExternalMCPError | null>(null)
  const [busy, setBusy] = useState<string | null>(null), [confirm, setConfirm] = useState<ExternalMCPStatus | null>(null)
  const [removal, setRemoval] = useState<ExternalMCPStatus | null>(null)
  const [feedback, setFeedback] = useState<Partial<Record<ExternalMCPTarget | 'other', Feedback>>>({})
  const generation = useRef(0), alive = useRef(true), working = useRef(false)
  const disabled = Boolean(busy || skills.busy) || loading || skills.loading
  async function refresh() {
    const current = ++generation.current
    setLoading(true); setLoadError(null)
    try {
      const result = await window.externalMCP.inspect({})
      if (!alive.current || current !== generation.current) return
      if (result.ok) setInspection(result.value)
      else setLoadError(result.error)
    } catch { if (alive.current && current === generation.current) setLoadError('CONFIG_UNAVAILABLE') }
    finally { if (alive.current && current === generation.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => { alive.current = false; generation.current++ }
  }, [])
  async function action(target: ExternalMCPTarget | 'other', operation: 'install' | 'reconnect' | 'remove' | 'test' | 'copy', status?: ExternalMCPStatus, replace = false) {
    if (working.current) return
    working.current = true
    setBusy(`${target}:${operation}`); setFeedback(previous => ({ ...previous, [target]: {} }))
    try {
      let next: Feedback
      if ((operation === 'install' || operation === 'reconnect' || operation === 'remove') && target !== 'other' && status) {
        const request = { target, revision: status.revision }
        const result: Awaited<ReturnType<typeof window.externalMCP.reconnect>> = operation === 'install' ? await window.externalMCP.install({ ...request, replace })
          : operation === 'reconnect' ? await window.externalMCP.reconnect(request) : await window.externalMCP.remove(request)
        if (result.ok) {
          next = { saved: operation === 'install', removed: operation === 'remove', reconnected: operation === 'reconnect', backupPath: result.value.backupPath,
            toolCount: result.value.toolCount, error: result.value.error }
          if (alive.current) setInspection(previous => previous && ({ ...previous,
            clients: previous.clients.map(client => client.target === target ? result.value.status : client) }))
        } else {
          next = { error: result.error }
          if (result.error === 'CONFIG_CHANGED' || result.error === 'REPLACE_REQUIRED') await refresh()
        }
      } else if (operation === 'test' && target !== 'other') {
        const result = await window.externalMCP.test({ target })
        next = result.ok ? { toolCount: result.value.toolCount } : { error: result.error }
      } else {
        const result = await window.externalMCP.copy({ target })
        next = result.ok ? { copied: true } : { error: result.error }
      }
      if (alive.current) setFeedback(previous => ({ ...previous, [target]: next }))
    } catch { if (alive.current) setFeedback(previous => ({ ...previous, [target]: { error: 'CONFIG_UNAVAILABLE' } })) }
    finally { working.current = false; if (alive.current) setBusy(null) }
  }
  const messages = (target: ExternalMCPTarget | 'other') => {
    const notice = feedback[target]
    return <>
      {notice?.error && <StatusMessage tone="error">{t($ => $.externalMCP.errors[notice.error!])}</StatusMessage>}
      {notice?.saved && <StatusMessage tone="success">{t($ => $.externalMCP.saved)}</StatusMessage>}
      {notice?.removed && <StatusMessage tone="success">{t($ => $.externalMCP.removed)}</StatusMessage>}
      {notice?.reconnected && <StatusMessage tone={notice.error ? 'info' : 'success'}>{t($ => notice.error ? $.externalMCP.reconnectSaved : $.externalMCP.reconnected)}</StatusMessage>}
      {notice?.copied && <StatusMessage tone="success">{t($ => $.externalMCP.copied)}</StatusMessage>}
      {notice?.toolCount !== undefined && <StatusMessage tone="success">{t($ => $.externalMCP.connected, { count: notice.toolCount })}</StatusMessage>}
      {notice?.backupPath && <DetailsList items={[{ label: t($ => $.externalMCP.backup), value: notice.backupPath }]} />}
    </>
  }
  return <SectionCard data-external-mcp title={t($ => $.externalMCP.title)} description={t($ => $.externalMCP.description)}>
    <div className="settings-stack" aria-busy={disabled}>
      <div><Button data-mcp-refresh disabled={disabled} onClick={() => { setFeedback({}); void refresh(); void skills.refresh() }}>{t($ => $.externalMCP.refresh)}</Button></div>
      {loading && <StatusMessage>{t($ => $.settings.loading)}</StatusMessage>}
      {loadError && <StatusMessage tone="error">{t($ => $.externalMCP.errors[loadError])}</StatusMessage>}
      <StatusMessage>{t($ => $.externalSkills.description)}</StatusMessage>
      {skills.loading && <StatusMessage>{t($ => $.settings.loading)}</StatusMessage>}
      {skills.error && <StatusMessage tone="error">{t($ => $.externalSkills.errors[skills.error!])}</StatusMessage>}
      {inspection?.clients.map(status => <SectionCard key={status.target} data-agent-target={status.target} title={names[status.target]}>
        <div className="settings-stack">
          <DetailsList items={[{ label: t($ => $.externalMCP.path), value: status.path }]} />
          <div><Badge tone={status.state === 'configured' ? 'success' : status.error ? 'error' : 'neutral'}>{t($ => $.externalMCP.states[status.state])}</Badge></div>
          {status.error && <StatusMessage tone="error">{t($ => $.externalMCP.errors[status.error!])}</StatusMessage>}
          <div className="settings-buttons">
            <Button data-mcp-install variant="primary" disabled={disabled || status.state === 'configured' || Boolean(status.error)} onClick={() => {
              if (status.state === 'different') setConfirm(status)
              else void action(status.target, 'install', status)
            }}>{busy === `${status.target}:install` ? t($ => $.externalMCP.installing) : status.state === 'different' ? t($ => $.externalMCP.replace) : t($ => $.externalMCP.add)}</Button>
            <Button data-mcp-test disabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'test')}>{busy === `${status.target}:test` ? t($ => $.settings.testing) : t($ => $.settings.testConnection)}</Button>
            <Button data-mcp-reconnect disabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'reconnect', status)}>{busy === `${status.target}:reconnect` ? t($ => $.externalMCP.reconnecting) : t($ => $.externalMCP.reconnect)}</Button>
            <Button data-mcp-remove variant="danger" disabled={disabled || status.state === 'missing' || Boolean(status.error)} onClick={() => setRemoval(status)}>{t($ => $.externalMCP.remove)}</Button>
            <Button data-mcp-copy disabled={disabled} onClick={() => void action(status.target, 'copy')}>{t($ => $.externalMCP.copy)}</Button>
          </div>
          {messages(status.target)}
          {skills.inspection?.clients.filter(client => client.target === status.target).map(client => <ExternalSkillsControls key={client.target}
            status={client} outcome={skills.outcomes[client.target]} disabled={disabled} busy={skills.busy === client.target}
            onInstall={() => skills.requestInstall(client)} onReconnect={() => skills.requestInstall(client, 'reconnect')}
            onRemove={names => skills.setRemoval({ status: client, names })} />)}
        </div>
      </SectionCard>)}
      {inspection && <SectionCard data-agent-target="other" title={t($ => $.externalMCP.other)} description={t($ => $.externalMCP.otherHelp)}>
        <div className="settings-stack">
          <FormField label={t($ => $.externalMCP.genericConfig)}>{props => <TextArea {...props} readOnly rows={8} value={inspection.genericConfig} spellCheck={false} />}</FormField>
          <div><Button data-mcp-copy disabled={disabled} onClick={() => void action('other', 'copy')}>{t($ => $.externalMCP.copy)}</Button></div>
          {messages('other')}
          <ExternalSkillsBundle skills={skills} disabled={disabled} />
        </div>
      </SectionCard>}
    </div>
    <Dialog open={Boolean(confirm)} title={t($ => $.externalMCP.replaceTitle)} description={t($ => $.externalMCP.replaceHelp, { agent: confirm ? names[confirm.target] : '' })}
      onClose={() => setConfirm(null)} content={confirm && <DetailsList items={[{ label: t($ => $.externalMCP.path), value: confirm.path }]} />}>
      <Button autoFocus onClick={() => setConfirm(null)}>{t($ => $.settings.cancel)}</Button>
      <Button data-mcp-confirm variant="danger" onClick={() => { if (confirm) void action(confirm.target, 'install', confirm, true); setConfirm(null) }}>{t($ => $.externalMCP.confirmReplace)}</Button>
    </Dialog>
    <Dialog open={Boolean(removal)} title={t($ => $.externalMCP.removeTitle)} description={t($ => $.externalMCP.removeHelp, { agent: removal ? names[removal.target] : '' })}
      onClose={() => setRemoval(null)} content={removal && <DetailsList items={[{ label: t($ => $.externalMCP.path), value: removal.path }]} />}>
      <Button autoFocus onClick={() => setRemoval(null)}>{t($ => $.settings.cancel)}</Button>
      <Button data-mcp-remove-confirm variant="danger" onClick={() => { if (removal) void action(removal.target, 'remove', removal); setRemoval(null) }}>{t($ => $.externalMCP.confirmRemove)}</Button>
    </Dialog>
    <ExternalSkillsConfirmation skills={skills} />
  </SectionCard>
}
