import { Button, Dialog, DialogHeader, Divider, Heading, MetadataList, MetadataListItem, Section, Stack, StatusDot, Text, TextArea } from '@astryxdesign/core'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPError, ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
import { useExternalSkills } from './useExternalSkills'
import { ExternalSkillsBundle, ExternalSkillsConfirmation, ExternalSkillsControls } from './ExternalSkillsSettings'

const names = { codex: 'Codex', 'claude-code': 'Claude Code', cursor: 'Cursor' }
type Feedback = { error?: ExternalMCPError; saved?: boolean; copied?: boolean; removed?: boolean; reconnected?: boolean; toolCount?: number; backupPath?: string }
export function ExternalMCPSettings() {
  const { t } = useTranslation()
  const skills = useExternalSkills()
  const detailId = useId()
  const [expandedAgent, setExpandedAgent] = useState<ExternalMCPTarget | null>(null)
  const [showGenericConfig, setShowGenericConfig] = useState(false)
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
      {notice?.backupPath && <MetadataList><MetadataListItem label={t($ => $.externalMCP.backup)}>{notice.backupPath}</MetadataListItem></MetadataList>}
    </>
  }
  return <Section variant="transparent" padding={0} data-external-mcp>
    <Stack gap={4}>
      <Stack direction="horizontal" justify="between" align="center" gap={2} wrap="wrap">
        <Heading level={2}>{t($ => $.settings.externalAgents)}</Heading>
        <Button data-mcp-refresh isDisabled={disabled} label={t($ => $.settings.refresh)}
          onClick={() => { setFeedback({}); void refresh(); void skills.refresh() }} />
      </Stack>
      {(loading || skills.loading) && <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text>}
      {loadError && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors[loadError])}</Text>}
      {skills.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalSkills.errors[skills.error!])}</Text>}
      {inspection && <>
        <Stack as="ul" role="list" className="settings-list">
          {inspection.clients.map((status, index) => {
            const expanded = expandedAgent === status.target
            const id = `${detailId}-${status.target}`
            const name = names[status.target]
            const state = t($ => $.externalMCP.states[status.state])
            const clientSkills = skills.inspection?.clients.find(client => client.target === status.target)

            return <Stack as="li" key={status.target} data-agent-target={status.target}>
              {index > 0 && <Divider />}
              <Stack className="settings-agent-row" direction="horizontal" align="center" justify="between" gap={2} wrap="wrap">
                <Text>{name}</Text>
                <Stack direction="horizontal" align="center" gap={2}>
                  <StatusDot aria-hidden="true" label={state}
                    variant={status.state === 'configured' ? 'success' : status.error ? 'error' : status.state === 'different' ? 'warning' : 'neutral'} />
                  <Text type="supporting">{state}</Text>
                </Stack>
                <Button variant="ghost" aria-expanded={expanded} aria-controls={id}
                  aria-label={t($ => $.settings.manageAgent, { name })} label={t($ => $.settings.manage)}
                  onClick={() => setExpandedAgent(expanded ? null : status.target)} />
              </Stack>
              <div id={id} hidden={!expanded}>
                {expanded && <Stack className="settings-agent-detail" gap={4}>
                  <Stack gap={2}>
                    <Heading level={3}>MCP</Heading>
                    <MetadataList>
                      <MetadataListItem label={t($ => $.externalMCP.path)}>{status.path}</MetadataListItem>
                    </MetadataList>
                    {status.error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.externalMCP.errors[status.error!])}</Text>}
                    <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
                      <Button data-mcp-install isDisabled={disabled || status.state === 'configured' || Boolean(status.error)} onClick={() => {
                        if (status.state === 'different') setConfirm(status)
                        else void action(status.target, 'install', status)
                      }} label={busy === `${status.target}:install` ? t($ => $.externalMCP.installing) : status.state === 'different' ? t($ => $.externalMCP.replace) : t($ => $.externalMCP.add)} />
                      <Button data-mcp-reconnect isDisabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'reconnect', status)}
                        label={busy === `${status.target}:reconnect` ? t($ => $.externalMCP.reconnecting) : t($ => $.externalMCP.reconnect)} />
                      <Button data-mcp-test isDisabled={disabled || status.state !== 'configured'} onClick={() => void action(status.target, 'test')}
                        label={busy === `${status.target}:test` ? t($ => $.settings.testing) : t($ => $.settings.testConnection)} />
                      <Button data-mcp-copy variant="ghost" isDisabled={disabled} onClick={() => void action(status.target, 'copy')} label={t($ => $.externalMCP.copy)} />
                      <Button data-mcp-remove variant="destructive" isDisabled={disabled || status.state === 'missing' || Boolean(status.error)}
                        onClick={() => setRemoval(status)} label={t($ => $.externalMCP.remove)} />
                    </Stack>
                    {messages(status.target)}
                  </Stack>
                  {clientSkills && <ExternalSkillsControls
                    status={clientSkills} outcome={skills.outcomes[clientSkills.target]} disabled={disabled} busy={skills.busy === clientSkills.target}
                    onInstall={() => skills.requestInstall(clientSkills)} onReconnect={() => skills.requestInstall(clientSkills, 'reconnect')}
                    onRemove={names => skills.setRemoval({ status: clientSkills, names })} />}
                </Stack>}
              </div>
            </Stack>
          })}
        </Stack>

        <Stack gap={2} data-agent-target="other">
          <Heading level={3}>{t($ => $.externalMCP.other)}</Heading>
          <Stack gap={2}>
            <Stack direction="horizontal" justify="between" align="center" gap={2} wrap="wrap">
              <Button variant="ghost" label={t($ => $.externalMCP.genericConfig)} aria-expanded={showGenericConfig}
                aria-controls={`${detailId}-generic`} onClick={() => setShowGenericConfig(!showGenericConfig)} />
              <Button data-mcp-copy variant="ghost" label={t($ => $.settings.copy)} aria-label={t($ => $.externalMCP.copy)}
                isDisabled={disabled} onClick={() => void action('other', 'copy')} />
            </Stack>
            <div id={`${detailId}-generic`} hidden={!showGenericConfig}>
              {showGenericConfig && <TextArea label={t($ => $.externalMCP.genericConfig)} isLabelHidden
                description={t($ => $.externalMCP.otherHelp)} isReadOnly rows={6} value={inspection.genericConfig} hasSpellCheck={false} />}
            </div>
            {messages('other')}
          </Stack>
          <ExternalSkillsBundle skills={skills} disabled={disabled} />
        </Stack>
      </>}
    </Stack>
    <Dialog isOpen={Boolean(confirm)} onOpenChange={() => setConfirm(null)} aria-label={t($ => $.externalMCP.replaceTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalMCP.replaceTitle)} subtitle={t($ => $.externalMCP.replaceHelp, { agent: confirm ? names[confirm.target] : '' })} />
      <div className="dialog-content">{confirm && <MetadataList><MetadataListItem label={t($ => $.externalMCP.path)}>{confirm.path}</MetadataListItem></MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => setConfirm(null)} label={t($ => $.settings.cancel)} />
      <Button data-mcp-confirm variant="destructive" onClick={() => { if (confirm) void action(confirm.target, 'install', confirm, true); setConfirm(null) }} label={t($ => $.externalMCP.confirmReplace)} />
    </Stack>
    </Dialog>
    <Dialog isOpen={Boolean(removal)} onOpenChange={() => setRemoval(null)} aria-label={t($ => $.externalMCP.removeTitle)} width={448} purpose="form">
      <DialogHeader title={t($ => $.externalMCP.removeTitle)} subtitle={t($ => $.externalMCP.removeHelp, { agent: removal ? names[removal.target] : '' })} />
      <div className="dialog-content">{removal && <MetadataList><MetadataListItem label={t($ => $.externalMCP.path)}>{removal.path}</MetadataListItem></MetadataList>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => setRemoval(null)} label={t($ => $.settings.cancel)} />
      <Button data-mcp-remove-confirm variant="destructive" onClick={() => { if (removal) void action(removal.target, 'remove', removal); setRemoval(null) }} label={t($ => $.externalMCP.confirmRemove)} />
    </Stack>
    </Dialog>
    <ExternalSkillsConfirmation skills={skills} />
  </Section>
}
