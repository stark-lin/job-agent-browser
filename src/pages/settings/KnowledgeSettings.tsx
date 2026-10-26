import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormField, SectionCard, StatusMessage, TextInput } from '../../shared/ui'
import { defaultKnowledgePreferences } from '../../shared/knowledge-settings'
export function KnowledgeSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation(),
    api = window.knowledge,
    [draft, setDraft] = useState(defaultKnowledgePreferences),
    [saved, setSaved] = useState(defaultKnowledgePreferences),
    [key, setKey] = useState(''),
    [configured, setConfigured] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [indexError, setIndexError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void api.configuration({})
      .then((config) => {
        if (!live) return
        if (config.ok) {
          setDraft(config.value.preferences)
          setSaved(config.value.preferences)
          setConfigured(config.value.tokenConfigured)
          setIndexError(config.value.indexError)
          setReady(true)
        } else setNotice(config.error)
      })
      .catch(() => setNotice('KNOWLEDGE_UNAVAILABLE'))
    return () => {
      live = false
    }
  }, [api])
  useEffect(() => {
    onDirty(ready && (JSON.stringify(draft) !== JSON.stringify(saved) || Boolean(key)))
    return () => onDirty(false)
  }, [ready, draft, saved, key, onDirty])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    try {
      await action()
    } catch {
      setNotice('KNOWLEDGE_UNAVAILABLE')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SectionCard title={t(($) => $.knowledge.settingsTitle)} description={t(($) => $.knowledge.settingsHelp)}>
      <div className="settings-stack">
        <FormField label={t(($) => $.knowledge.remote)}>
          {(props) => (
            <TextInput
              {...props}
              type="url"
              value={draft.remote}
              disabled={!ready || busy}
              onChange={(e) => setDraft({ ...draft, remote: e.target.value })}
              placeholder="https://github.com/owner/repository.git"
            />
          )}
        </FormField>
        <FormField label={t(($) => $.knowledge.branch)}>
          {(props) => (
            <TextInput
              {...props}
              value={draft.branch}
              disabled={!ready || busy}
              onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
            />
          )}
        </FormField>
        <FormField
          label={t(($) => $.knowledge.token)}
          help={configured ? t(($) => $.knowledge.tokenConfigured) : t(($) => $.knowledge.tokenHelp)}
        >
          {(props) => (
            <TextInput
              {...props}
              type="password"
              autoComplete="off"
              value={key}
              disabled={!ready || busy}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </FormField>
        <div className="settings-actions">
          <Button
            disabled={!key || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.token({ token: key })
                if (r.ok) {
                  setConfigured(r.value.configured)
                  setKey('')
                  setNotice('saved')
                  const config = await api.configuration({})
                  if (config.ok) setIndexError(config.value.indexError)
                } else setNotice(r.error)
              })
            }
          >
            {t(($) => $.knowledge.saveToken)}
          </Button>
          <Button
            disabled={!configured || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.token({ token: null })
                if (r.ok) {
                  setConfigured(false)
                  setKey('')
                } else setNotice(r.error)
              })
            }
          >
            {t(($) => $.knowledge.removeToken)}
          </Button>
        </div>
        <Checkbox
          label={t(($) => $.knowledge.semanticEnable)}
          checked={draft.semanticEnabled}
          disabled={!ready || busy}
          onChange={(e) => setDraft({ ...draft, semanticEnabled: e.target.checked })}
        />
        <StatusMessage>{t(($) => $.knowledge.semanticHelp)}</StatusMessage>
        {draft.semanticEnabled && indexError && <StatusMessage tone="error">{t(($) => $.knowledge.semanticUnavailable)}</StatusMessage>}
        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.configure(draft)
                if (r.ok) {
                  setDraft(r.value)
                  setSaved(r.value)
                  setNotice('saved')
                  const config = await api.configuration({})
                  if (config.ok) setIndexError(config.value.indexError)
                } else setNotice(r.error)
              })
            }
          >
            {t(($) => $.knowledge.saveSettings)}
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.sync({})
                setNotice(r.ok ? r.value.state : r.error)
              })
            }
          >
            {t(($) => $.knowledge.sync)}
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.rebuild({})
                setNotice(r.ok ? 'rebuilt' : r.error)
              })
            }
          >
            {t(($) => $.knowledge.rebuild)}
          </Button>
        </div>
        {notice && (
          <StatusMessage tone={['saved', 'synced', 'local', 'rebuilt'].includes(notice) ? 'success' : 'error'}>
            {['saved', 'synced', 'local', 'rebuilt', 'conflict', 'failed'].includes(notice)
              ? t(($) => $.knowledge[notice as 'saved' | 'synced' | 'local' | 'rebuilt' | 'conflict' | 'failed'])
              : t(($) => $.knowledge.error) + ` (${notice})`}
          </StatusMessage>
        )}
      </div>
    </SectionCard>
  )
}
