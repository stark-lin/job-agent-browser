import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  IconButton,
  Glyph,
  Dialog,
  FormField,
  TextInput,
  Markdown,
  MarkdownEditor,
  ResizableExplorer,
  StatusMessage
} from '../../shared/ui'
import type { KnowledgeNode, BackupVersion, KnowledgeHit } from '../../domain/knowledge'
import { defaultKnowledgePreferences, type KnowledgePreferences } from '../../shared/knowledge-settings'
import { useKnowledge } from './useKnowledge'
import { KnowledgeTree } from './KnowledgeTree'
import './knowledge.css'
type Action = { kind: 'file' | 'folder' | 'rename' | 'delete' | 'menu' | 'saveAs'; node: KnowledgeNode }
export function KnowledgePage() {
  const { t } = useTranslation(),
    k = useKnowledge(),
    api = window.knowledge,
    [selected, setSelected] = useState(''),
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
    [restore, setRestore] = useState<BackupVersion | null>(null)
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
  const begin = (kind: Action['kind'], node = target) => {
    if (!node) return
    if (kind === 'rename' || kind === 'delete') {
      setBusy(true)
      void (async () => {
        if (!(await k.flush())) return
        const tree = await api.tree({})
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
        setAction({ kind, node: current })
        setName(kind === 'rename' ? current.path : '')
      })()
        .catch(() => k.setError('KNOWLEDGE_UNAVAILABLE'))
        .finally(() => setBusy(false))
      return
    }
    setAction({ kind, node })
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
      const path = name.replace(/^\//, '')
      const result =
        action.kind === 'file'
          ? await api.write({ path, content: '', expectedRevision: null })
          : action.kind === 'folder'
            ? await api.mkdir({ path })
            : action.kind === 'rename'
              ? await api.move({
                  source: action.node.path,
                  target: path,
                  expectedRevision: action.node.revision
                })
              : action.kind === 'delete'
                ? await api.delete({
                    path: action.node.path,
                    expectedRevision: action.node.revision,
                    recursive: action.node.type === 'directory'
                  })
                : null
      if (action.kind === 'saveAs') {
        if (await k.saveAs(path)) {
          setAction(null)
          setSelected(path)
        }
        return
      }
      if (result && !result.ok) {
        k.setError(result.error)
        if (result.error === 'KNOWLEDGE_CONFLICT') setAction(null)
        return
      }
      setAction(null)
      if (action.kind === 'file' || action.kind === 'rename') setSelected(path)
      await k.refresh()
      if (action.kind === 'file') await k.open(path)
      if (
        action.kind === 'rename' &&
        k.file &&
        (k.file.path === action.node.path || k.file.path.startsWith(action.node.path + '/'))
      )
        await k.open(path + k.file.path.slice(action.node.path.length))
    } catch {
      k.setError('KNOWLEDGE_UNAVAILABLE')
    } finally {
      setBusy(false)
    }
  }
  const select = (node: KnowledgeNode) => {
    setSelected(node.path)
    if (node.type === 'file') void k.open(node.path)
    else if (node.readme) void k.open(node.readme)
  }
  const historyPage = async (more = false) => {
    if (!(await k.flush())) return
    const result = await api.history({ offset: more ? (history?.length ?? 0) : 0, limit: 25 })
    if (result.ok) setHistory((old) => (more ? [...(old ?? []), ...result.value] : result.value))
    else k.setError(result.error)
  }
  const synchronize = async () => {
    if (!(await k.flush())) return
    setBusy(true)
    try {
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
      void k.open(decodeURIComponent(url.pathname.slice(1)))
    } catch {
      k.setError('KNOWLEDGE_INVALID_PATH')
    }
  }
  return (
    <main className="knowledge-page" data-knowledge-page>
      <ResizableExplorer
        width={preferences.explorerWidth}
        onWidth={(explorerWidth) => setPreferences((p) => ({ ...p, explorerWidth }))}
        label={t(($) => $.knowledge.resize)}
      >
        <div className="knowledge-explorer-heading">
          <strong>{t(($) => $.knowledge.explorer)}</strong>
          <IconButton
            aria-label={t(($) => $.knowledge.newFile)}
            title={t(($) => $.knowledge.newFile)}
            onClick={() => begin('file')}
          >
            <Glyph name="document" />
          </IconButton>
          <IconButton
            aria-label={t(($) => $.knowledge.newFolder)}
            title={t(($) => $.knowledge.newFolder)}
            onClick={() => begin('folder')}
          >
            <Glyph name="plus" />
          </IconButton>
        </div>
        <form
          className="knowledge-search"
          onSubmit={(e) => {
            e.preventDefault()
            void api.search({ query }).then((r) => {
              if (r.ok) setHits(r.value.items)
              else k.setError(r.error)
            })
          }}
        >
          <TextInput
            aria-label={t(($) => $.knowledge.search)}
            placeholder={t(($) => $.knowledge.search)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <IconButton type="submit" aria-label={t(($) => $.knowledge.search)} disabled={!query.trim()}>
            <Glyph name="search" />
          </IconButton>
        </form>
        {hits && (
          <div className="knowledge-results">
            <Button variant="ghost" size="sm" onClick={() => setHits(null)}>
              {t(($) => $.knowledge.close)}
            </Button>
            {hits.map((hit) => (
              <Button key={hit.id} variant="ghost" onClick={() => void k.open(hit.path)}>
                {hit.path}:{hit.startLine}
              </Button>
            ))}
            {!hits.length && <StatusMessage>{t(($) => $.knowledge.noResults)}</StatusMessage>}
          </div>
        )}
        {k.tree ? (
          <KnowledgeTree
            tree={k.tree}
            selected={selected}
            onSelect={select}
            onAction={(kind, node) => begin(kind, node)}
          />
        ) : (
          <StatusMessage>{t(($) => $.knowledge.loading)}</StatusMessage>
        )}
      </ResizableExplorer>
      <section className="knowledge-workspace">
        <header className="knowledge-toolbar">
          <div className="knowledge-breadcrumb">
            {k.file?.path.split('/').join(' › ') ?? t(($) => $.navigation.pages.knowledge)}
          </div>
          <div className="knowledge-toolbar-actions">
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
              >
                {t(($) => $.knowledge[mode])}
              </Button>
            ))}
            <Button size="sm" onClick={() => void historyPage()}>
              {t(($) => $.knowledge.history)}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void synchronize()}>
              {t(($) => $.knowledge.sync)}
            </Button>
          </div>
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
          {syncDetail && ` · ${syncDetail}`}
        </div>
        {k.error && (
          <StatusMessage tone="error">
            {t(($) => $.knowledge.error)} ({k.error})
          </StatusMessage>
        )}
        {k.conflict && (
          <div className="knowledge-conflict">
            <StatusMessage tone="error">{t(($) => $.knowledge.externalConflict)}</StatusMessage>
            <Button onClick={() => void k.reload()}>{t(($) => $.knowledge.reload)}</Button>
            <Button onClick={() => begin('saveAs')}>{t(($) => $.knowledge.saveAs)}</Button>
          </div>
        )}
        {k.file ? (
          <div className={`knowledge-document knowledge-document--${preferences.mode}`}>
            {preferences.mode !== 'preview' && (
              <MarkdownEditor
                key={k.file.path}
                label={t(($) => $.knowledge.editor)}
                value={k.content}
                onChange={k.change}
                onSave={() => void k.flush()}
              />
            )}
            {preferences.mode !== 'edit' && (
              <div className="knowledge-preview" data-knowledge-preview>
                <Markdown
                  text={k.content}
                  copyLabel={t(($) => $.ask.copy)}
                  copiedLabel={t(($) => $.ask.copied)}
                  onOpenLink={relativeLink}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="knowledge-empty">
            <h1>{t(($) => $.navigation.pages.knowledge)}</h1>
            <p>{t(($) => $.knowledge.empty)}</p>
          </div>
        )}
      </section>
      <Dialog
        open={Boolean(action)}
        title={
          action
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
            : ''
        }
        description={action?.kind === 'delete' ? t(($) => $.knowledge.deleteHelp) : (action?.node.path ?? '')}
        onClose={() => setAction(null)}
        content={
          action?.kind === 'menu' ? (
            <div className="knowledge-menu">
              {(['file', 'folder', 'rename', 'delete'] as const).map((kind) => (
                <Button
                  key={kind}
                  disabled={!action.node.path && (kind === 'rename' || kind === 'delete')}
                  onClick={() => begin(kind, action.node)}
                >
                  {t(($) => $.knowledge[kind === 'file' ? 'newFile' : kind === 'folder' ? 'newFolder' : kind])}
                </Button>
              ))}
              {action.node.type === 'directory' && !action.node.readme && (
                <Button
                  onClick={() => {
                    setName((action.node.path ? action.node.path + '/' : '') + 'README.md')
                    setAction({ ...action, kind: 'file' })
                  }}
                >
                  {t(($) => $.knowledge.createReadme)}
                </Button>
              )}
            </div>
          ) : action?.kind !== 'delete' ? (
            <FormField label={t(($) => $.knowledge.path)}>
              {(props) => (
                <TextInput
                  {...props}
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void run()
                  }}
                />
              )}
            </FormField>
          ) : undefined
        }
      >
        <Button onClick={() => setAction(null)}>{t(($) => $.knowledge.cancel)}</Button>
        {action?.kind !== 'menu' && (
          <Button variant={action?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy} onClick={() => void run()}>
            {t(($) => $.knowledge.confirm)}
          </Button>
        )}
      </Dialog>
      <Dialog
        open={history !== null}
        title={t(($) => $.knowledge.history)}
        description={t(($) => $.knowledge.historyHelp)}
        onClose={() => setHistory(null)}
        content={
          <div className="knowledge-history">
            {history?.map((version) => (
              <article key={version.commit}>
                <strong>{new Date(version.timestamp).toLocaleString()}</strong>
                <p>{version.reason}</p>
                <pre>{version.files.join('\n')}</pre>
                <Button size="sm" onClick={() => setRestore(version)}>
                  {t(($) => $.knowledge.restore)}
                </Button>
              </article>
            ))}
          </div>
        }
      >
        <Button onClick={() => void historyPage(true)}>{t(($) => $.knowledge.more)}</Button>
        <Button onClick={() => setHistory(null)}>{t(($) => $.knowledge.close)}</Button>
      </Dialog>
      <Dialog
        open={Boolean(restore)}
        title={t(($) => $.knowledge.restore)}
        description={t(($) => $.knowledge.restoreHelp)}
        onClose={() => setRestore(null)}
      >
        <Button onClick={() => setRestore(null)}>{t(($) => $.knowledge.cancel)}</Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (!restore || !k.tree) return
            setBusy(true)
            void k
              .flush()
              .then(async (okay) => {
                if (!okay) return
                const tree = await api.tree({})
                if (!tree.ok) return
                const result = await api.restore({ commit: restore.commit, expectedRevision: tree.value.revision })
                if (result.ok) {
                  setRestore(null)
                  setHistory(null)
                  await k.refresh()
                  await k.reload()
                } else k.setError(result.error)
              })
              .finally(() => setBusy(false))
          }}
        >
          {t(($) => $.knowledge.confirm)}
        </Button>
      </Dialog>
    </main>
  )
}
