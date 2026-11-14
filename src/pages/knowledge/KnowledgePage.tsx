import { Button, Dialog, DialogHeader, EmptyState, Icon, IconButton, LayoutPanel, Stack, Text, TextInput } from '@astryxdesign/core'
import { FileText, Plus } from 'lucide-react'
import { UntrustedProse } from '../../app/content/UntrustedProse'
import { KnowledgeSourceEditor } from './KnowledgeSourceEditor'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpaceId } from '../../shared/smart-note'
import type { KnowledgeNode, BackupVersion, KnowledgeHit } from '../../domain/knowledge'
import { defaultKnowledgePreferences, type KnowledgePreferences } from '../../shared/knowledge-settings'
import { RemoteSyncDialog } from '../../app/knowledge/RemoteSyncDialog'
import { useKnowledge } from './useKnowledge'
import { KnowledgeTree } from './KnowledgeTree'
import './knowledge.css'
type Action = { kind: 'file' | 'folder' | 'rename' | 'delete' | 'menu' | 'saveAs'; node: KnowledgeNode; space: SpaceId }
export function KnowledgePage() {
  const { t } = useTranslation(),
    k = useKnowledge(),
    api = window.knowledge,
    selected = k.selection.path,
    space = k.selection.space,
    [preferences, setPreferences] = useState<KnowledgePreferences>(defaultKnowledgePreferences),
    [action, setAction] = useState<Action | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<BackupVersion[] | null>(null),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<KnowledgeHit[] | null>(null),
    [sync, setSync] = useState(''),
    [syncDetail, setSyncDetail] = useState(''),
    [backupDirty, setBackupDirty] = useState(false),
    [restore, setRestore] = useState<BackupVersion | null>(null),
    [consent, setConsent] = useState<string | null>(null)
  const searchGeneration = useRef(0)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const resize = (width: number) => setPreferences(p => ({
    ...p, explorerWidth: Math.max(192, Math.min(480, Math.round(width / 8) * 8))
  }))
  useEffect(() => { searchGeneration.current++; setHits(null); setQuery(''); setHistory(null); setRestore(null) }, [space])
  useEffect(() => {
    void api.configuration({}).then((r) => {
      if (r.ok) setPreferences(r.value.preferences)
    })
  }, [api])
  useEffect(() => {
    let live = true
    const refresh = () => {
      void api.status({}).then((r) => {
        if (live && r.ok) {
          setBackupDirty(r.value.dirty)
          setSync(r.value.state)
          setSyncDetail(r.value.conflictBranch ?? r.value.error ?? '')
        }
      })
    }
    refresh()
    const interval = setInterval(refresh, 5000),
      stop = api.onChanged(refresh)
    return () => {
      live = false
      clearInterval(interval)
      stop()
    }
  }, [api])
  useEffect(() => {
    const timer = setTimeout(() => {
      void api.view({ mode: preferences.mode, explorerWidth: preferences.explorerWidth })
    }, 500)
    return () => clearTimeout(timer)
  }, [api, preferences])
  const find = (path: string, node = k.tree): KnowledgeNode | undefined =>
    !node ? undefined : node.path === path ? node : node.children?.map((n) => find(path, n)).find(Boolean)
  const target = find(selected) ?? k.tree
  const begin = (kind: Action['kind'], node = target, actionSpace = space) => {
    if (!node) return
    if (kind === 'rename' || kind === 'delete') {
      setBusy(true)
      void (async () => {
        if (!(await k.flush())) return
        const tree = await api.tree({ space: actionSpace })
        if (!tree.ok) {
          k.setError(tree.error)
          return
        }
        const current = find(node.path, tree.value)
        if (!current) {
          k.setError('KNOWLEDGE_NOT_FOUND')
          return
        }
        k.setError('')
        setAction({ kind, node: current, space: actionSpace })
        setName(kind === 'rename' ? current.path : '')
      })()
        .catch(() => k.setError('KNOWLEDGE_UNAVAILABLE'))
        .finally(() => setBusy(false))
      return
    }
    setAction({ kind, node, space: actionSpace })
    setName(
      kind === 'file' || kind === 'folder'
          ? (node.type === 'directory' ? node.path : node.path.split('/').slice(0, -1).join('/')) + '/'
          : kind === 'saveAs'
            ? (k.file?.path.replace(/\.md$/i, '-copy.md') ?? 'copy.md')
            : ''
    )
  }
  const run = async () => {
    if (!action || busy) return
    setBusy(true)
    try {
      if (action.kind !== 'saveAs' && !(await k.flush())) return
      const path = name.replace(/^\//, ''), actionSpace = action.space
      const result =
        action.kind === 'file'
          ? await api.write({ space: actionSpace, path, content: '', expectedRevision: null })
          : action.kind === 'folder'
            ? await api.mkdir({ space: actionSpace, path })
            : action.kind === 'rename'
              ? await api.move({
                  space: actionSpace,
                  source: action.node.path,
                  target: path,
                  expectedRevision: action.node.revision
                })
              : action.kind === 'delete'
                ? await api.delete({
                    space: actionSpace,
                    path: action.node.path,
                    expectedRevision: action.node.revision,
                    recursive: action.node.type === 'directory'
                  })
                : null
      if (action.kind === 'saveAs') {
        if (await k.saveAs(path)) {
          setAction(null)
        }
        return
      }
      if (result && !result.ok) {
        k.setError(result.error)
        if (result.error === 'KNOWLEDGE_CONFLICT') setAction(null)
        return
      }
      setAction(null)
      await k.refresh()
      if (action.kind === 'file') await k.open(path, actionSpace)
      if (
        action.kind === 'rename' &&
        k.file &&
        (k.file.space === actionSpace && (k.file.path === action.node.path || k.file.path.startsWith(action.node.path + '/')))
      )
        await k.open(path + k.file.path.slice(action.node.path.length), actionSpace)
    } catch {
      k.setError('KNOWLEDGE_UNAVAILABLE')
    } finally {
      setBusy(false)
    }
  }
  const historyPage = async (more = false) => {
    if (!(await k.flush())) return
    const result = await api.history({ space, offset: more ? (history?.length ?? 0) : 0, limit: 25 })
    if (space !== k.scope.current) return
    if (result.ok) setHistory((old) => (more ? [...(old ?? []), ...result.value] : result.value))
    else k.setError(result.error)
  }
  const synchronize = async () => {
    if (!(await k.flush())) return
    setBusy(true)
    try {
      const approval = await api.syncConsent({})
      if (!approval.ok) { k.setError(approval.error); return }
      if (approval.value.required) { setConsent(approval.value.remote); return }
      const result = await api.sync({})
      if (result.ok) {
        setSync(result.value.state)
        setBackupDirty(result.value.dirty)
        setSyncDetail(result.value.conflictBranch ?? result.value.error ?? '')
      } else k.setError(result.error)
      await k.refresh()
    } finally {
      setBusy(false)
    }
  }
  const relativeLink = (href: string) => {
    if (!k.file) return
    try {
      const url = new URL(href, 'https://knowledge.local/' + k.file.path)
      if (url.origin !== 'https://knowledge.local') return
      void k.open(decodeURIComponent(url.pathname.slice(1)), k.file.space)
    } catch {
      k.setError('KNOWLEDGE_INVALID_PATH')
    }
  }
  return (
    <main className="knowledge-page" aria-label={t($ => $.navigation.pages.knowledge)} data-knowledge-page>
      <LayoutPanel width={preferences.explorerWidth} padding={0} role="complementary" isScrollable>
        <div className="knowledge-explorer-heading">
          <strong>{t(($) => $.knowledge.explorer)}</strong>
          <IconButton size="sm" variant="ghost" label={t($ => $.knowledge.newFile)} tooltip={t($ => $.knowledge.newFile)}
            icon={<Icon icon={FileText} />} onClick={() => begin('file')} />
          <IconButton size="sm" variant="ghost" label={t($ => $.knowledge.newFolder)} tooltip={t($ => $.knowledge.newFolder)}
            icon={<Icon icon={Plus} />} onClick={() => begin('folder')} />
        </div>
        <form
          className="knowledge-search"
          onSubmit={(e) => {
            e.preventDefault()
            const generation = ++searchGeneration.current
            void api.search({ query, space }).then((r) => {
              if (generation !== searchGeneration.current || space !== k.scope.current) return
              if (r.ok) setHits(r.value.items)
              else k.setError(r.error)
            })
          }}
        >
          <TextInput
            label={t(($) => $.knowledge.search)}
            placeholder={t(($) => $.knowledge.search)}
            value={query}
            onChange={e => setQuery(e)} isLabelHidden
          />
          <IconButton type="submit" size="sm" variant="ghost" label={t($ => $.knowledge.search)}
            icon={<Icon icon="search" />} isDisabled={!query.trim()} />
        </form>
        {hits && (
          <div className="knowledge-results">
            <Button variant="ghost" size="sm" onClick={() => { searchGeneration.current++; setHits(null) }} label={t(($) => $.knowledge.close)} />
            {hits.map((hit) => (
              <Button key={hit.id} variant="ghost" label={`${hit.path}:${hit.startLine}`} onClick={() => void k.open(hit.path, space)} />
            ))}
            {!hits.length && <Text as="p" type="supporting" role="status">{t(($) => $.knowledge.noResults)}</Text>}
          </div>
        )}
        {(['memory', 'knowledge'] as const).map(treeSpace => k.trees[treeSpace] ? (
          <KnowledgeTree
            key={treeSpace}
            tree={k.trees[treeSpace]!}
            memory={treeSpace === 'memory'}
            label={t($ => $.knowledge[treeSpace === 'memory' ? 'memory' : 'knowledgeSpace'])}
            selected={space === treeSpace ? selected : '\u0000'}
            onSelect={node => k.select(node, treeSpace)}
            onAction={(kind, node) => begin(kind, node, treeSpace)}
          />
        ) : <Text key={treeSpace} as="p" type="supporting" role="status">{t(($) => $.knowledge.loading)}</Text>)}
      </LayoutPanel>
      <div className="knowledge-resize-handle" role="separator" aria-label={t($ => $.knowledge.resize)}
        aria-orientation="vertical" aria-valuenow={preferences.explorerWidth} aria-valuemin={192} aria-valuemax={480}
        tabIndex={0}
        onPointerDown={event => {
          resizeStart.current = { x: event.clientX, width: preferences.explorerWidth }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const start = resizeStart.current
          if (start) resize(start.width + event.clientX - start.x)
        }}
        onLostPointerCapture={() => { resizeStart.current = null }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          resize(preferences.explorerWidth + (event.key === 'ArrowLeft' ? -8 : 8))
        }} />
      <section className="knowledge-workspace">
        <header className="knowledge-toolbar">
          <div className="knowledge-breadcrumb">
            {k.file ? `${t($ => $.knowledge[k.file?.space === 'memory' ? 'memory' : 'knowledgeSpace'])} › ${k.file.path.split('/').join(' › ')}` : t(($) => $.navigation.pages.knowledge)}
          </div>
          <Stack className="knowledge-toolbar-actions" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
            {(['edit', 'split', 'preview'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={preferences.mode === mode ? 'primary' : 'ghost'}
                aria-pressed={preferences.mode === mode}
                onClick={() => {
                  setPreferences((p) => ({ ...p, mode }))
                  void api.view({ mode, explorerWidth: preferences.explorerWidth })
                }}
               label={t(($) => $.knowledge[mode])} />
            ))}
            <Button size="sm" onClick={() => void historyPage()} label={t(($) => $.knowledge.history)} />
            <Button size="sm" isDisabled={busy} onClick={() => void synchronize()} label={t(($) => $.knowledge.sync)} />
          </Stack>
        </header>
        <div className="knowledge-save-status" aria-live="polite">
          {k.saving
            ? t(($) => $.knowledge.saving)
            : k.dirty
              ? t(($) => $.knowledge.pending)
              : t(($) => $.knowledge.saved)}
          {backupDirty
            ? ` · ${t(($) => $.knowledge.backupPending)}`
            : sync && ` · ${t(($) => $.knowledge[sync as 'local' | 'synced' | 'conflict' | 'failed'])}`}
          {syncDetail && ` · ${syncDetail === 'SYNC_CONSENT_REQUIRED' ? t($ => $.knowledge.syncConsentRequired) : syncDetail}`}
        </div>
        {k.error && (
          <Text as="p" type="supporting" role="alert" className="error-message">
            {t(($) => $.knowledge.error)} ({k.error})
          </Text>
        )}
        {k.conflict && (
          <div className="knowledge-conflict">
            <Text as="p" type="supporting" role="alert" className="error-message">{t(($) => $.knowledge.externalConflict)}</Text>
            <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
              <Button onClick={() => void k.reload()} label={t(($) => $.knowledge.reload)} />
              <Button onClick={() => begin('saveAs')} label={t(($) => $.knowledge.saveAs)} />
            </Stack>
          </div>
        )}
        {k.file ? (
          <div className={`knowledge-document knowledge-document--${preferences.mode}`}>
            {preferences.mode !== 'preview' && (
              <KnowledgeSourceEditor
                key={`${k.file.space}:${k.file.path}`}
                label={t(($) => $.knowledge.editor)}
                value={k.content}
                onChange={k.change}
                onSave={() => void k.flush()}
              />
            )}
            {preferences.mode !== 'edit' && (
              <div className="knowledge-preview" data-knowledge-preview>
                <UntrustedProse text={k.content} onOpenLink={relativeLink} />
              </div>
            )}
          </div>
        ) : (
          <EmptyState className="knowledge-empty" title={t($ => $.knowledge.empty)} />
        )}
      </section>
      <Dialog  isOpen={Boolean(action)} onOpenChange={() => setAction(null)} aria-label={action
            ? t(
                ($) =>
                  $.knowledge[
                    action.kind === 'menu'
                      ? 'actions'
                      : action.kind === 'file'
                        ? 'newFile'
                        : action.kind === 'folder'
                          ? 'newFolder'
                          : action.kind === 'rename'
                            ? 'rename'
                            : action.kind === 'delete'
                              ? 'delete'
                              : 'saveAs'
                  ]
              )
            : ''} width={448} purpose="form">
      <DialogHeader title={action
            ? t(
                ($) =>
                  $.knowledge[
                    action.kind === 'menu'
                      ? 'actions'
                      : action.kind === 'file'
                        ? 'newFile'
                        : action.kind === 'folder'
                          ? 'newFolder'
                          : action.kind === 'rename'
                            ? 'rename'
                            : action.kind === 'delete'
                              ? 'delete'
                              : 'saveAs'
                  ]
              )
            : ''} subtitle={action?.kind === 'delete' ? t(($) => $.knowledge.deleteHelp) : (action?.node.path ?? '')} />
      <div className="dialog-content">{action?.kind === 'menu' ? (
            <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
              {(['file', 'folder', 'rename', 'delete'] as const).map((kind) => (
                <Button
                  key={kind}
                  isDisabled={!action.node.path && (kind === 'rename' || kind === 'delete')}
                  onClick={() => begin(kind, action.node, action.space)}
                 label={t(($) => $.knowledge[kind === 'file' ? 'newFile' : kind === 'folder' ? 'newFolder' : kind])} />
              ))}
              {action.node.type === 'directory' && !action.node.readme && (
                <Button
                  onClick={() => {
                    setName((action.node.path ? action.node.path + '/' : '') + 'README.md')
                    setAction({ ...action, kind: 'file' })
                  }}
                 label={t(($) => $.knowledge.createReadme)} />
              )}
            </Stack>
          ) : action?.kind !== 'delete' ? (
            <TextInput
                  label={t(($) => $.knowledge.path)}
                  hasAutoFocus
                  value={name}
                  onChange={e => setName(e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void run()
                  }}
                />
          ) : undefined}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
        <Button onClick={() => setAction(null)} label={t(($) => $.knowledge.cancel)} />
        {action?.kind !== 'menu' && (
          <Button variant={action?.kind === 'delete' ? 'destructive' : 'primary'} isDisabled={busy} onClick={() => void run()} label={t(($) => $.knowledge.confirm)} />
        )}
      </Stack>
    </Dialog>
      <Dialog  isOpen={history !== null} onOpenChange={() => setHistory(null)} aria-label={t(($) => $.knowledge.history)} width={448} purpose="form">
      <DialogHeader title={t(($) => $.knowledge.history)} subtitle={`${t($ => $.knowledge[space === 'memory' ? 'memory' : 'knowledgeSpace'])} · ${t(($) => $.knowledge.historyHelp)}`} />
      <div className="dialog-content">{<div className="knowledge-history">
            {history?.map((version) => (
              <article key={version.commit}>
                <strong>{new Date(version.timestamp).toLocaleString()}</strong>
                <p>{version.reason}</p>
                <pre>{version.files.join('\n')}</pre>
                <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button size="sm" onClick={() => setRestore(version)} label={t(($) => $.knowledge.restore)} /></Stack>
              </article>
            ))}
          </div>}</div>
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
        <Button onClick={() => void historyPage(true)} label={t(($) => $.knowledge.more)} />
        <Button onClick={() => setHistory(null)} label={t(($) => $.knowledge.close)} />
      </Stack>
    </Dialog>
      <Dialog  isOpen={Boolean(restore)} onOpenChange={() => setRestore(null)} aria-label={t(($) => $.knowledge.restore)} width={448} purpose="form">
      <DialogHeader title={t(($) => $.knowledge.restore)} subtitle={`${t($ => $.knowledge[space === 'memory' ? 'memory' : 'knowledgeSpace'])} · ${t(($) => $.knowledge.restoreHelp)}`} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
        <Button onClick={() => setRestore(null)} label={t(($) => $.knowledge.cancel)} />
        <Button
          isDisabled={busy}
          onClick={() => {
            if (!restore || !k.tree) return
            setBusy(true)
            void k
              .flush()
              .then(async (okay) => {
                if (!okay) return
                const tree = await api.tree({ space })
                if (!tree.ok) return
                const result = await api.restore({ space, commit: restore.commit, expectedRevision: tree.value.revision })
                if (result.ok) {
                  setRestore(null)
                  setHistory(null)
                  await k.refresh()
                  await k.reload()
                } else k.setError(result.error)
              })
              .finally(() => setBusy(false))
          }}
         label={t(($) => $.knowledge.confirm)} />
      </Stack>
    </Dialog>
      <RemoteSyncDialog remote={consent} busy={busy} onCancel={() => setConsent(null)} onConfirm={() => {
        if (!consent) return
        setBusy(true)
        void api.approveSync({ remote: consent }).then(async result => {
          if (!result.ok) { k.setError(result.error); return }
          setConsent(null); await synchronize()
        }).finally(() => setBusy(false))
      }} />
    </main>
  )
}
