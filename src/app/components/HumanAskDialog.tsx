import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HumanRequest } from '../../shared/human'
import { Button, Dialog, FormField, Radio, StatusMessage, TextArea } from '../../shared/ui'

export function HumanAskDialog() {
  const { t } = useTranslation(), [request, setRequest] = useState<HumanRequest>(), [selected, setSelected] = useState<string | null>(null), [text, setText] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  useEffect(() => {
    let live = true, revision = 0
    const refresh = () => {
      const current = ++revision
      void window.human.list().then(result => { if (live && current === revision && result.ok) setRequest(result.value[0]) })
    }
    const stop = window.human.subscribe(refresh); refresh()
    return () => { live = false; stop() }
  }, [])
  useEffect(() => { setSelected(null); setText(''); setError(false); setBusy(false) }, [request?.id])
  const finish = async (cancel: boolean) => {
    if (!request || busy) return
    setBusy(true); setError(false)
    try {
      const result = cancel ? await window.human.cancel(request.id) : await window.human.answer(request.id, selected, text)
      if (!result.ok) setError(true)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  if (!request) return null
  return <Dialog open title={t($ => $.human.title)} description={request?.question} onClose={() => void finish(true)} content={<>
    {request?.options?.map(option => <Radio key={option} name="human-answer" label={option} checked={selected === option} disabled={busy} onChange={() => setSelected(option)} />)}
    {selected !== null && <Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>{t($ => $.human.clear)}</Button>}
    <FormField label={t($ => $.human.text)}>{control => <TextArea {...control} value={text} maxLength={20000} disabled={busy} onChange={event => setText(event.target.value)} />}</FormField>
    {error && <StatusMessage tone="error">{t($ => $.human.error)}</StatusMessage>}
  </>}>
    <Button disabled={busy} onClick={() => void finish(true)}>{t($ => $.human.cancel)}</Button>
    <Button variant="primary" disabled={busy || selected === null && !text.trim()} onClick={() => void finish(false)}>{t($ => $.human.submit)}</Button>
  </Dialog>
}
