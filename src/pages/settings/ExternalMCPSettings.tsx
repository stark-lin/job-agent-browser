import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExternalMCPError, ExternalMCPInspection, ExternalMCPStatus, ExternalMCPTarget } from '../../shared/external-mcp'
import { Badge, Button, DetailsList, Dialog, FormField, SectionCard, StatusMessage, TextArea } from '../../shared/ui'

const names = { codex: 'Codex', 'claude-code': 'Claude Code', cursor: 'Cursor' }
type Feedback = { error?: ExternalMCPError; saved?: boolean; copied?: boolean; toolCount?: number; backupPath?: string }
export function ExternalMCPSettings() {
  const { t } = useTranslation()
  const [inspection, setInspection] = useState<ExternalMCPInspection | null>(null)
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<ExternalMCPError | null>(null)
  const [busy, setBusy] = useState<string | null>(null), [confirm, setConfirm] = useState<ExternalMCPStatus | null>(null)
  const [feedback, setFeedback] = useState<Partial<Record<ExternalMCPTarget | 'other', Feedback>>>({})
  const generation = useRef(0), alive = useRef(true), working = useRef(false)
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
  async function action(target: ExternalMCPTarget | 'other', operation: 'install' | 'test' | 'copy', status?: ExternalMCPStatus, replace = false) {
    if (working.current) return
    working.current = true
    setBusy(`${target}:${operation}`); setFeedback(previous => ({ ...previous, [target]: {} }))
    try {
      let next: Feedback
      if (operation === 'install' && target !== 'other' && status) {
        const result = await window.externalMCP.install({ target, revision: status.revision, replace })
        if (result.ok) {
          next = { saved: true, backupPath: result.value.backupPath }
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
      {notice?.copied && <StatusMessage tone="success">{t($ => $.externalMCP.copied)}</StatusMessage>}
      {notice?.toolCount !== undefined && <StatusMessage tone="success">{t($ => $.externalMCP.connected, { count: notice.toolCount })}</StatusMessage>}
      {notice?.backupPath && <DetailsList items={[{ label: t($ => $.externalMCP.backup), value: notice.backupPath }]} />}
    </>
  }
  return <SectionCard data-external-mcp title={t($ => $.externalMCP.title)} description={t($ => $.externalMCP.description)}>
    <div className="settings-stack" aria-busy={Boolean(busy) || loading}>
      <div><Button data-mcp-refresh disabled={Boolean(busy) || loading} onClick={() => { setFeedback({}); void refresh() }}>{t($ => $.externalMCP.refresh)}</Button></div>
      {loading && <StatusMessage>{t($ => $.settings.loading)}</StatusMessage>}
      {loadError && <StatusMessage tone="error">{t($ => $.externalMCP.errors[loadError])}</StatusMessage>}
      {inspection?.clients.map(status => <SectionCard key={status.target} data-agent-target={status.target} title={names[status.target]}>
        <div className="settings-stack">
          <DetailsList items={[{ label: t($ => $.externalMCP.path), value: status.path }]} />
          <div><Badge tone={status.state === 'configured' ? 'success' : status.error ? 'error' : 'neutral'}>{t($ => $.externalMCP.states[status.state])}</Badge></div>
          {status.error && <StatusMessage tone="error">{t($ => $.externalMCP.errors[status.error!])}</StatusMessage>}
          <div className="settings-buttons">
            <Button data-mcp-install variant="primary" disabled={Boolean(busy) || loading || status.state === 'configured' || Boolean(status.error)} onClick={() => {
              if (status.state === 'different') setConfirm(status)
              else void action(status.target, 'install', status)
            }}>{busy === `${status.target}:install` ? t($ => $.externalMCP.installing) : status.state === 'different' ? t($ => $.externalMCP.replace) : t($ => $.externalMCP.add)}</Button>
            <Button data-mcp-test disabled={Boolean(busy) || loading || status.state !== 'configured'} onClick={() => void action(status.target, 'test')}>{busy === `${status.target}:test` ? t($ => $.settings.testing) : t($ => $.settings.testConnection)}</Button>
            <Button data-mcp-copy disabled={Boolean(busy) || loading} onClick={() => void action(status.target, 'copy')}>{t($ => $.externalMCP.copy)}</Button>
          </div>
          {messages(status.target)}
        </div>
      </SectionCard>)}
      {inspection && <SectionCard data-agent-target="other" title={t($ => $.externalMCP.other)} description={t($ => $.externalMCP.otherHelp)}>
        <div className="settings-stack">
          <FormField label={t($ => $.externalMCP.genericConfig)}>{props => <TextArea {...props} readOnly rows={8} value={inspection.genericConfig} spellCheck={false} />}</FormField>
          <div><Button data-mcp-copy disabled={Boolean(busy) || loading} onClick={() => void action('other', 'copy')}>{t($ => $.externalMCP.copy)}</Button></div>
          {messages('other')}
        </div>
      </SectionCard>}
    </div>
    <Dialog open={Boolean(confirm)} title={t($ => $.externalMCP.replaceTitle)} description={t($ => $.externalMCP.replaceHelp, { agent: confirm ? names[confirm.target] : '' })}
      onClose={() => setConfirm(null)} content={confirm && <DetailsList items={[{ label: t($ => $.externalMCP.path), value: confirm.path }]} />}>
      <Button autoFocus onClick={() => setConfirm(null)}>{t($ => $.settings.cancel)}</Button>
      <Button data-mcp-confirm variant="danger" onClick={() => { if (confirm) void action(confirm.target, 'install', confirm, true); setConfirm(null) }}>{t($ => $.externalMCP.confirmReplace)}</Button>
    </Dialog>
  </SectionCard>
}
