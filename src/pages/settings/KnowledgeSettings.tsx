import { Button, CheckboxInput, Divider, FormLayout, Heading, Section, Selector, Stack, Text, TextInput } from '@astryxdesign/core'
import { RemoteSyncDialog } from '../../app/knowledge/RemoteSyncDialog'
import type { SpaceId } from '../../shared/smart-note'
import { LocalModelSettings } from './LocalModelSettings'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultKnowledgePreferences } from '../../shared/knowledge-settings'
type NoticeArea = 'configuration' | 'token' | 'sync' | 'index'

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
    [noticeArea, setNoticeArea] = useState<NoticeArea>('configuration'),
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
  const run = async (area: NoticeArea, action: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    setNoticeArea(area)
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
  const feedback = (area: NoticeArea) => {
    if (!notice || noticeArea !== area) return null
    const status = notice === 'saved' || notice === 'synced' || notice === 'local' || notice === 'rebuilt'
    let message: string
    if (status || notice === 'conflict' || notice === 'failed') message = t($ => $.knowledge[notice])
    else if (notice === 'SYNC_CONSENT_REQUIRED') message = t($ => $.knowledge.syncConsentRequired)
    else message = t($ => $.knowledge.error) + ` (${notice})`
    return <Text as="p" type="supporting" role={status ? 'status' : 'alert'} className={status ? undefined : 'error-message'}>{message}</Text>
  }

  return <Section variant="transparent" padding={0}>
    <Stack gap={4}>
      <Heading level={2}>{t($ => $.knowledge.settingsTitle)}</Heading>
      {!ready && (notice ? feedback('configuration')
        : <Text as="p" type="supporting" role="status">{t($ => $.settings.loading)}</Text>)}

      <Stack gap={3}>
        <Heading level={3}>{t($ => $.knowledge.remoteSync)}</Heading>
        <FormLayout>
          <TextInput label={t($ => $.knowledge.remote)} type="url" value={draft.remote} isDisabled={!ready || busy}
            onChange={remote => setDraft({ ...draft, remote })} placeholder="https://github.com/owner/repository.git" />
          <TextInput label={t($ => $.knowledge.branch)} value={draft.branch} isDisabled={!ready || busy}
            onChange={branch => setDraft({ ...draft, branch })} />
          <Stack gap={2}>
            <TextInput label={t($ => $.knowledge.token)} description={configured ? t($ => $.knowledge.tokenConfigured) : t($ => $.knowledge.tokenHelp)}
              type="password" autoComplete="off" value={key} isDisabled={!ready || busy} onChange={setKey} />
            <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
              <Button isDisabled={!key || busy} label={t($ => $.knowledge.saveToken)}
                onClick={() => void run('token', async () => {
                  const result = await api.token({ token: key })
                  if (result.ok) {
                    setConfigured(result.value.configured)
                    setKey('')
                    setNotice('saved')
                    const config = await api.configuration({})
                    if (config.ok) setIndexError(config.value.indexError)
                  } else setNotice(result.error)
                })} />
              <Button variant="destructive" isDisabled={!configured || busy} label={t($ => $.knowledge.removeToken)}
                onClick={() => void run('token', async () => {
                  const result = await api.token({ token: null })
                  if (result.ok) {
                    setConfigured(false)
                    setKey('')
                  } else setNotice(result.error)
                })} />
            </Stack>
            {feedback('token')}
          </Stack>

          <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
            <Button variant="primary" isDisabled={!ready || busy} label={t($ => $.knowledge.saveSettings)}
              onClick={() => void run('configuration', async () => {
                const result = await api.configure(draft)
                if (result.ok) {
                  setDraft(result.value)
                  setSaved(result.value)
                  setNotice('saved')
                  const config = await api.configuration({})
                  if (config.ok) setIndexError(config.value.indexError)
                } else setNotice(result.error)
              })} />
            <Button isDisabled={!ready || busy} label={t($ => $.knowledge.sync)} onClick={() => void run('sync', synchronize)} />
          </Stack>
          {ready && feedback('configuration')}
          {feedback('sync')}
        </FormLayout>
      </Stack>

      <Divider />
      <Stack gap={3}>
        <Heading level={3}>{t($ => $.knowledge.semanticSearch)}</Heading>
        <FormLayout>
          <CheckboxInput label={t($ => $.knowledge.semanticEnable)} description={t($ => $.knowledge.semanticHelp)}
            value={draft.semanticEnabled} isDisabled={!ready || busy}
            onChange={semanticEnabled => setDraft({ ...draft, semanticEnabled })} />
          <LocalModelSettings />
          {draft.semanticEnabled && indexError && <Text as="p" type="supporting" role="alert" className="error-message">
            {t($ => $.knowledge.semanticUnavailable)}
          </Text>}
        </FormLayout>
      </Stack>

      <Divider />
      <Stack gap={3}>
        <Heading level={3}>{t($ => $.knowledge.index)}</Heading>
        <FormLayout>
          <Selector label={t($ => $.knowledge.indexSpace)} value={indexSpace} isDisabled={!ready || busy}
            onChange={value => { if (value === 'knowledge' || value === 'memory') setIndexSpace(value) }}
            options={[
              { value: 'knowledge', label: t($ => $.knowledge.knowledgeSpace) },
              { value: 'memory', label: t($ => $.knowledge.memory) }
            ]} />
          <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
            <Button isDisabled={!ready || busy} label={t($ => $.knowledge.rebuild)}
              onClick={() => void run('index', async () => {
                const result = await api.rebuild({ space: indexSpace })
                setNotice(result.ok ? 'rebuilt' : result.error)
              })} />
            {feedback('index')}
          </Stack>
        </FormLayout>
      </Stack>
    </Stack>
    <RemoteSyncDialog remote={consent} busy={busy} onCancel={() => setConsent(null)} onConfirm={() => {
      if (!consent) return
      void run('sync', async () => {
        const result = await api.approveSync({ remote: consent })
        if (!result.ok) { setNotice(result.error); return }
        setConsent(null); await synchronize()
      })
    }} />
  </Section>
}
