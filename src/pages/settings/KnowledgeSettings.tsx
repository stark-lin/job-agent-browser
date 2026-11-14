import { Button, CheckboxInput, Heading, Section, Selector, Stack, Text, TextInput } from '@astryxdesign/core'
import { RemoteSyncDialog } from '../../app/knowledge/RemoteSyncDialog'
import type { SpaceId } from '../../shared/smart-note'
import { LocalModelSettings } from './LocalModelSettings'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
    [consent, setConsent] = useState<string | null>(null),
    [indexSpace, setIndexSpace] = useState<SpaceId>('knowledge'),
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
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = api.onChanged(() => {
      timer ??= setTimeout(() => {
        timer = undefined
        void api.configuration({}).then(config => { if (live && config.ok) setIndexError(config.value.indexError) }).catch(() => {})
      }, 150)
    })
    return () => {
      live = false
      clearTimeout(timer)
      unsubscribe()
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
  const synchronize = async () => {
    const status = await api.syncConsent({})
    if (!status.ok) { setNotice(status.error); return }
    if (status.value.required) { setConsent(status.value.remote); return }
    const result = await api.sync({})
    setNotice(result.ok ? result.value.error ?? result.value.state : result.error)
  }
  return (
    <Section className="feature-section" padding={0}><details onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t(($) => $.knowledge.settingsTitle)}</Heading></summary>
      <div className="feature-section-body">{t(($) => $.knowledge.settingsHelp) && <p>{t(($) => $.knowledge.settingsHelp)}</p>}
      <div className="settings-stack">
        <TextInput
              label={t(($) => $.knowledge.remote)}
              type="url"
              value={draft.remote}
              isDisabled={!ready || busy}
              onChange={e => setDraft({ ...draft, remote: e })}
              placeholder="https://github.com/owner/repository.git"
            />
        <TextInput
              label={t(($) => $.knowledge.branch)}
              value={draft.branch}
              isDisabled={!ready || busy}
              onChange={e => setDraft({ ...draft, branch: e })}
            />
        <TextInput
              label={t(($) => $.knowledge.token)} description={configured ? t(($) => $.knowledge.tokenConfigured) : t(($) => $.knowledge.tokenHelp)}
              type="password"
              autoComplete="off"
              value={key}
              isDisabled={!ready || busy}
              onChange={e => setKey(e)}
            />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
          <Button
            isDisabled={!key || busy}
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
           label={t(($) => $.knowledge.saveToken)} />
          <Button
            isDisabled={!configured || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.token({ token: null })
                if (r.ok) {
                  setConfigured(false)
                  setKey('')
                } else setNotice(r.error)
              })
            }
           label={t(($) => $.knowledge.removeToken)} />
        </Stack>
        <CheckboxInput
          label={t(($) => $.knowledge.semanticEnable)}
          value={draft.semanticEnabled}
          isDisabled={!ready || busy}
          onChange={e => setDraft({ ...draft, semanticEnabled: e })}
        />
        <Text as="p" type="supporting" role="status">{t(($) => $.knowledge.semanticHelp)}</Text>
        <LocalModelSettings />
        {draft.semanticEnabled && indexError && <Text as="p" type="supporting" role="alert" className="error-message">{t(($) => $.knowledge.semanticUnavailable)}</Text>}
        <Selector label={t($ => $.knowledge.indexSpace)} value={indexSpace} onChange={value => { if (value === 'knowledge' || value === 'memory') setIndexSpace(value) }} isDisabled={!ready || busy}  options={[({ value: "knowledge", label: t($ => $.knowledge.knowledgeSpace) }), ({ value: "memory", label: t($ => $.knowledge.memory) })]} />
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
          <Button
            variant="primary"
            isDisabled={!ready || busy}
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
           label={t(($) => $.knowledge.saveSettings)} />
          <Button
            isDisabled={!ready || busy}
            onClick={() =>
              void run(async () => {
                await synchronize()
              })
            }
           label={t(($) => $.knowledge.sync)} />
          <Button
            isDisabled={!ready || busy}
            onClick={() =>
              void run(async () => {
                const r = await api.rebuild({ space: indexSpace })
                setNotice(r.ok ? 'rebuilt' : r.error)
              })
            }
           label={t(($) => $.knowledge.rebuild)} />
        </Stack>
        {notice && (
          <Text as="p" type="supporting" role="status">
            {['saved', 'synced', 'local', 'rebuilt', 'conflict', 'failed'].includes(notice)
              ? t(($) => $.knowledge[notice as 'saved' | 'synced' | 'local' | 'rebuilt' | 'conflict' | 'failed'])
              : notice === 'SYNC_CONSENT_REQUIRED' ? t($ => $.knowledge.syncConsentRequired) : t(($) => $.knowledge.error) + ` (${notice})`}
          </Text>
        )}
        <RemoteSyncDialog remote={consent} busy={busy} onCancel={() => setConsent(null)} onConfirm={() => {
          if (!consent) return
          void run(async () => {
            const result = await api.approveSync({ remote: consent })
            if (!result.ok) { setNotice(result.error); return }
            setConsent(null); await synchronize()
          })
        }} />
      </div>
    </div></details></Section>
  )
}
