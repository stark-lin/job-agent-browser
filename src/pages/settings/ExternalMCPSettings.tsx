import { Badge, Button, Dialog, DialogHeader, Heading, MetadataList, MetadataListItem, Section, Stack, Text, TextArea } from '@astryxdesign/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPError, ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
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
      {notice?.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors[notice.error!])}</Text>}
      {notice?.saved && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalMCP.saved)}</Text>}
      {notice?.removed && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalMCP.removed)}</Text>}
      {notice?.reconnected && <Text as="p" type="supporting" role="status">{t($ => notice.error ? $.externalMCP.reconnectSaved : $.externalMCP.reconnected)}</Text>}
      {notice?.copied && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalMCP.copied)}</Text>}
      {notice?.toolCount !== undefined && <Text as="p" type="supporting" role="status" className="success-message">{t($ => $.externalMCP.connected, { count: notice.toolCount })}</Text>}
      {notice?.backupPath && <MetadataList>{([{ label: t($ => $.externalMCP.backup), value: notice.backupPath }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}
    </>
  }
  return <Section className="feature-section" padding={0}><details data-external-mcp  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.externalMCP.title)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.externalMCP.description) && <p>{t($ => $.externalMCP.description)}</p>}
    <div className="settings-stack" aria-busy={disabled}>
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button data-mcp-refresh isDisabled={disabled} onClick={() => { setFeedback({}); void refresh(); void skills.refresh() }} label={t($ => $.externalMCP.refresh)} /></Stack>
      {loading && <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text>}
      {loadError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors[loadError])}</Text>}
      <Text as="p" type="supporting" role="status">{t($ => $.externalSkills.description)}</Text>
      {skills.loading && <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text>}
      {skills.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[skills.error!])}</Text>}
      {inspection?.clients.map(status => <Section key={status.target} className="feature-section" padding={0}><details data-agent-target={status.target}  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{names[status.target]}</Heading></summary>
      <div className="feature-section-body">
        <div className="settings-stack">
          <MetadataList>{([{ label: t($ => $.externalMCP.path), value: status.path }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>
          <div><Badge  variant={status.state === 'configured' ? 'success' : status.error ? 'error' : 'neutral'} label={t($ => $.externalMCP.states[status.state])} /></div>
          {status.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors[status.error!])}</Text>}
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
            <Button data-mcp-install variant="primary" isDisabled={disabled || status.state === 'configured' || Boolean(status.error)} onClick={() => {
              if (status.state === 'different') setConfirm(status)
              else void action(status.target, 'install', status)
            }} label={busy === `${status.target}:install` ? t($ => $.externalMCP.installing) : status.state === 'different' ? t($ => $.externalMCP.replace) : t($ => $.externalMCP.add)} />
            <Button data-mcp-test isDisabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'test')} label={busy === `${status.target}:test` ? t($ => $.settings.testing) : t($ => $.settings.testConnection)} />
            <Button data-mcp-reconnect isDisabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'reconnect', status)} label={busy === `${status.target}:reconnect` ? t($ => $.externalMCP.reconnecting) : t($ => $.externalMCP.reconnect)} />
            <Button data-mcp-remove variant="destructive" isDisabled={disabled || status.state === 'missing' || Boolean(status.error)} onClick={() => setRemoval(status)} label={t($ => $.externalMCP.remove)} />
            <Button data-mcp-copy isDisabled={disabled} onClick={() => void action(status.target, 'copy')} label={t($ => $.externalMCP.copy)} />
          </Stack>
          {messages(status.target)}
          {skills.inspection?.clients.filter(client => client.target === status.target).map(client => <ExternalSkillsControls key={client.target}
            status={client} outcome={skills.outcomes[client.target]} disabled={disabled} busy={skills.busy === client.target}
            onInstall={() => skills.requestInstall(client)} onReconnect={() => skills.requestInstall(client, 'reconnect')}
            onRemove={names => skills.setRemoval({ status: client, names })} />)}
        </div>
      </div></details></Section>)}
      {inspection && <Section className="feature-section" padding={0}><details data-agent-target="other"  onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.externalMCP.other)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.externalMCP.otherHelp) && <p>{t($ => $.externalMCP.otherHelp)}</p>}
        <div className="settings-stack">
          <TextArea label={t($ => $.externalMCP.genericConfig)} isReadOnly rows={8} value={inspection.genericConfig} hasSpellCheck={false} />
          <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button data-mcp-copy isDisabled={disabled} onClick={() => void action('other', 'copy')} label={t($ => $.externalMCP.copy)} /></Stack>
          {messages('other')}
          <ExternalSkillsBundle skills={skills} disabled={disabled} />
        </div>
      </div></details></Section>}
    </div>
    <Dialog  isOpen={Boolean(confirm)} onOpenChange={() => setConfirm(null)} aria-label={t($ => $.externalMCP.replaceTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalMCP.replaceTitle)} subtitle={t($ => $.externalMCP.replaceHelp, { agent: confirm ? names[confirm.target] : '' })} />
      <div className="dialog-content">{confirm && <MetadataList>{([{ label: t($ => $.externalMCP.path), value: confirm.path }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => setConfirm(null)} label={t($ => $.settings.cancel)} />
      <Button data-mcp-confirm variant="destructive" onClick={() => { if (confirm) void action(confirm.target, 'install', confirm, true); setConfirm(null) }} label={t($ => $.externalMCP.confirmReplace)} />
    </Stack>
    </Dialog>
    <Dialog  isOpen={Boolean(removal)} onOpenChange={() => setRemoval(null)} aria-label={t($ => $.externalMCP.removeTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalMCP.removeTitle)} subtitle={t($ => $.externalMCP.removeHelp, { agent: removal ? names[removal.target] : '' })} />
      <div className="dialog-content">{removal && <MetadataList>{([{ label: t($ => $.externalMCP.path), value: removal.path }]).map(({ label, value }, index) => <MetadataListItem key={index} label={label}>{value}</MetadataListItem>)}</MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => setRemoval(null)} label={t($ => $.settings.cancel)} />
      <Button data-mcp-remove-confirm variant="destructive" onClick={() => { if (removal) void action(removal.target, 'remove', removal); setRemoval(null) }} label={t($ => $.externalMCP.confirmRemove)} />
    </Stack>
    </Dialog>
    <ExternalSkillsConfirmation skills={skills} />
  </div></details></Section>
}
