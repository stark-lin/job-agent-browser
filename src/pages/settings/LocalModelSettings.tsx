import { Button, Dialog, DialogHeader, MetadataList, MetadataListItem, ProgressBar, Stack, Text } from '@astryxdesign/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelStatus } from '../../shared/models'
export function LocalModelSettings() {
  const { t } = useTranslation()
  const [model, setModel] = useState<ModelStatus>()
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const refresh = async () => {
      const result = await window.knowledge.modelStatus({})
      if (live && result.ok) setModel(result.value)
    }
    void refresh()
    // Coalesce high-frequency transfer events before requesting a new projection.
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = window.knowledge.onChanged(() => { timer ??= setTimeout(() => { timer = undefined; void refresh() }, 150) })
    return () => { live = false; clearTimeout(timer); unsubscribe() }
  }, [])
  const run = async (method: 'modelInstall' | 'modelRemove' | 'modelVerify' | 'modelCancel') => {
    if (method !== 'modelCancel') setBusy(true)
    setError('')
    try {
      const result = method === 'modelInstall' ? await window.knowledge.modelInstall({ source: 'download' }) : await window.knowledge[method]({})
      if (!result.ok) setError(result.error)
      const status = await window.knowledge.modelStatus({})
      if (status.ok) setModel(status.value)
    } catch { setError('MODEL_OPERATION_FAILED') }
    finally { if (method !== 'modelCancel') setBusy(false) }
  }
  if (!model) return null
  const code = error || model.error
  const working = ['installing', 'verifying', 'removing'].includes(model.state)
  return <Stack gap={2} data-local-model>
    <MetadataList>
      <MetadataListItem label={t($ => $.knowledge.localModel)}>{model.id} · {model.dimensions}</MetadataListItem>
      <MetadataListItem label={t($ => $.knowledge.modelState)}>{t($ => $.knowledge.modelStates[model.state])}</MetadataListItem>
      <MetadataListItem label={t($ => $.knowledge.modelStorage)}>{Math.ceil(model.total / 1000000)} MB · {model.directory}</MetadataListItem>
    </MetadataList>
    {working && <ProgressBar label={t($ => $.knowledge.modelProgress)} max={model.total} value={model.completed} isLabelHidden />}
    {model.state !== 'removing' && <Stack direction="horizontal" align="center" gap={2} wrap="wrap">
      {model.state !== 'ready' && !working && <Button isDisabled={busy} onClick={() => void run('modelInstall')} label={model.state === 'missing' ? t($ => $.knowledge.downloadModel) : t($ => $.knowledge.repairModel)} />}
      {!working && model.state !== 'missing' && <>
        <Button isDisabled={busy} onClick={() => void run('modelVerify')} label={t($ => $.knowledge.verifyModel)} />
        <Button variant="destructive" isDisabled={busy} onClick={() => setRemove(true)} label={t($ => $.knowledge.removeModel)} />
      </>}
      {working && <Button onClick={() => void run('modelCancel')} label={t($ => $.knowledge.cancel)} />}
    </Stack>}
    {code && <Text as="p" type="supporting" role="status">
      {code === 'MODEL_CANCELLED' ? t($ => $.knowledge.modelCancelled) : code === 'MODEL_BUSY' ? t($ => $.knowledge.modelBusy) : t($ => $.knowledge.modelError)}
      {code !== 'MODEL_CANCELLED' && ` (${code})`}
    </Text>}
    <Dialog isOpen={remove} onOpenChange={() => setRemove(false)} aria-label={t($ => $.knowledge.removeModel)} width={448} purpose="form">
      <DialogHeader title={t($ => $.knowledge.removeModel)} subtitle={t($ => $.knowledge.removeModelHelp)} />
      <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button data-autofocus="true" onClick={() => setRemove(false)} label={t($ => $.knowledge.cancel)} />
      <Button variant="destructive" onClick={() => { setRemove(false); void run('modelRemove') }} label={t($ => $.knowledge.removeModel)} />
    </Stack>
    </Dialog>
  </Stack>
}
