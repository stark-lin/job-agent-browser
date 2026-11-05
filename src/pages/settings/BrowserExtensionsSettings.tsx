import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Dialog, SectionCard, StatusMessage, Switch } from '../../shared/ui'
import type { ExtensionError, ExtensionReply, ExtensionView } from '../../shared/browser-extensions'

export function BrowserExtensionsSettings() {
  const { t } = useTranslation()
  const api = window.browserExtensions
  const [extensions, setExtensions] = useState<ExtensionView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [listError, setListError] = useState<ExtensionError | null>(null)
  const [actionError, setActionError] = useState<ExtensionError | null>(null)
  const [removal, setRemoval] = useState<ExtensionView | null>(null)
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    let revision = 0
    refresh.current = () => {
      const current = ++revision
      void api.list().then(result => {
        if (!active || revision !== current) return
        if (result.ok) setExtensions(result.value)
        setListError(result.ok ? null : result.error)
      }).catch(() => { if (active && revision === current) setListError('UNAVAILABLE') })
    }
    const unsubscribe = api.onChanged(refresh.current)
    refresh.current()
    return () => { active = false; unsubscribe(); refresh.current = () => {} }
  }, [api])

  const run = async (id: string, operation: () => Promise<ExtensionReply<null>>) => {
    setBusy(id)
    setActionError(null)
    try {
      const result = await operation()
      if (!result.ok) setActionError(result.error)
    } catch { setActionError('UNAVAILABLE') }
    finally { setBusy(null); refresh.current() }
  }

  return <SectionCard data-browser-extensions title={t($ => $.extensions.title)} description={t($ => $.extensions.scope)}>
    <div className="settings-stack">
      <div className="settings-actions">
        <Button variant="primary" data-extension-import disabled={!!busy || !!listError}
          onClick={() => void run('import', () => api.importDirectory())}>{t($ => $.extensions.import)}</Button>
      </div>
      {listError && <div className="settings-actions">
        <StatusMessage tone="error">{t($ => $.extensions.errors[listError])}</StatusMessage>
        <Button onClick={() => refresh.current()}>{t($ => $.settings.retry)}</Button>
      </div>}
      {actionError && <StatusMessage tone="error">{t($ => $.extensions.errors[actionError])}</StatusMessage>}
      {!extensions && !listError && <StatusMessage>{t($ => $.settings.loading)}</StatusMessage>}
      {extensions?.length === 0 && !listError && <StatusMessage>{t($ => $.extensions.empty)}</StatusMessage>}
      {extensions?.map(extension => {
        const { id, name, version, status, source } = extension
        const pending = status === 'PENDING_REMOVAL'
        const controlsDisabled = !!busy || !!listError || pending || status === 'LOADING'
        return <div className="settings-extension settings-stack" key={id} data-extension={id}>
          <div className="settings-extension-row">
            {extension.canOpenOptions
              ? <Button variant="ghost" data-extension-options aria-label={t($ => $.extensions.openOptions, { name })}
                disabled={controlsDisabled} onClick={() => void run(id, () => api.openOptions(id))}>{name}</Button>
              : <strong>{name}</strong>}
            <span>{version} · {t($ => $.extensions.source[source])}</span>
            <Badge tone={status === 'FAILED' ? 'error' : status === 'RUNNING' ? 'success' : 'neutral'}>{t($ => $.extensions.status[status])}</Badge>
            <div className="settings-extension-controls">
              {status === 'FAILED' && <Button size="sm" disabled={controlsDisabled}
                onClick={() => void run(id, () => api.setEnabled(id, true))}>{t($ => $.settings.retry)}</Button>}
              <Switch label={t($ => $.extensions.enable, { name })} checked={extension.enabled} disabled={controlsDisabled}
                onChange={enabled => void run(id, () => api.setEnabled(id, enabled))} />
              <Button variant="danger" size="sm" data-extension-delete disabled={controlsDisabled}
                aria-label={t($ => $.extensions.deleteNamed, { name })} onClick={() => setRemoval(extension)}>{t($ => $.extensions.delete)}</Button>
            </div>
          </div>
          <div>{t($ => $.extensions.permissions, { values: extension.permissions.join(', ') || t($ => $.extensions.none) })}</div>
          <div>{t($ => $.extensions.sites, { values: extension.sites.join(', ') || t($ => $.extensions.none) })}</div>
          {pending && <StatusMessage tone={extension.cleanupFailed ? 'error' : 'info'}>{extension.cleanupFailed
            ? t($ => $.extensions.cleanupFailed) : t($ => $.extensions.pending)}</StatusMessage>}
        </div>
      })}
    </div>
    <Dialog open={!!removal} title={t($ => $.extensions.confirmDelete, { name: removal?.name ?? '' })}
      description={t($ => $.extensions.deleteHelp)} onClose={() => setRemoval(null)}>
      <Button autoFocus onClick={() => setRemoval(null)}>{t($ => $.settings.cancel)}</Button>
      <Button variant="danger" data-extension-confirm-delete onClick={() => {
        if (removal) void run(removal.id, () => api.remove(removal.id))
        setRemoval(null)
      }}>{t($ => $.extensions.delete)}</Button>
    </Dialog>
  </SectionCard>
}
