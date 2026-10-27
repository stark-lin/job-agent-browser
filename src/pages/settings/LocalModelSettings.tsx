import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, DetailsList, Dialog, Progress, StatusMessage } from '../../shared/ui'
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
  return <div className="settings-stack" data-local-model>
    <DetailsList items={[
      { label: t($ => $.knowledge.localModel), value: `${model.id} · ${model.dimensions}` },
      { label: t($ => $.knowledge.modelState), value: t($ => $.knowledge.modelStates[model.state]) },
      { label: t($ => $.knowledge.modelStorage), value: `${Math.ceil(model.total / 1000000)} MB · ${model.directory}` }
    ]} />
    {working && <Progress aria-label={t($ => $.knowledge.modelProgress)} max={model.total} value={model.completed} />}
    <div className="settings-actions">
      {model.state !== 'ready' && !working && <Button variant="primary" disabled={busy} onClick={() => void run('modelInstall')}>
        {model.state === 'missing' ? t($ => $.knowledge.downloadModel) : t($ => $.knowledge.repairModel)}
      </Button>}
      {!working && model.state !== 'missing' && <>
        <Button disabled={busy} onClick={() => void run('modelVerify')}>{t($ => $.knowledge.verifyModel)}</Button>
        <Button disabled={busy} onClick={() => setRemove(true)}>{t($ => $.knowledge.removeModel)}</Button>
      </>}
      {working && model.state !== 'removing' && <Button onClick={() => void run('modelCancel')}>{t($ => $.knowledge.cancel)}</Button>}
    </div>
    {code && <StatusMessage tone={code === 'MODEL_CANCELLED' ? 'neutral' : 'error'}>
      {code === 'MODEL_CANCELLED' ? t($ => $.knowledge.modelCancelled) : code === 'MODEL_BUSY' ? t($ => $.knowledge.modelBusy) : t($ => $.knowledge.modelError)}
      {code !== 'MODEL_CANCELLED' && ` (${code})`}
    </StatusMessage>}
    <Dialog open={remove} title={t($ => $.knowledge.removeModel)} description={t($ => $.knowledge.removeModelHelp)} onClose={() => setRemove(false)}>
      <Button autoFocus onClick={() => setRemove(false)}>{t($ => $.knowledge.cancel)}</Button>
      <Button onClick={() => { setRemove(false); void run('modelRemove') }}>{t($ => $.knowledge.removeModel)}</Button>
    </Dialog>
  </div>
}
