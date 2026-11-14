import { Button, Dialog, DialogHeader, RadioList, RadioListItem, Stack, Text, TextArea } from '@astryxdesign/core'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HumanRequest } from '../../shared/human'

export function HumanAskDialog() {
  const { t } = useTranslation(), [request, setRequest] = useState<HumanRequest>(), [selected, setSelected] = useState<string | null>(null), [text, setText] = useState('')
  const questionId = useId()
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
  return <Dialog isOpen onOpenChange={() => void finish(true)} aria-label={t($ => $.human.title)}
    aria-describedby={questionId} width={448} purpose="form">
    <DialogHeader title={t($ => $.human.title)} subtitle={<span id={questionId}>{request.question}</span>} />
    <div className="dialog-content">
      {request.options?.length ? <RadioList label={request.question} isLabelHidden htmlName="human-answer"
        value={selected ?? ''} isDisabled={busy} onChange={setSelected}>
        {request.options.map(option => <RadioListItem key={option} label={option} value={option} />)}
      </RadioList> : null}
      {selected !== null && <Button variant="ghost" isDisabled={busy} onClick={() => setSelected(null)} label={t($ => $.human.clear)} />}
      <TextArea label={t($ => $.human.text)} value={text} ref={input => { if (input) input.maxLength = 20000 }}
        isDisabled={busy} onChange={setText} />
      {error && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.human.error)}</Text>}
    </div>
    <Stack direction="horizontal" justify="end" align="center" gap={2} wrap="wrap" className="action-row">
      <Button isDisabled={busy} onClick={() => void finish(true)} label={t($ => $.human.cancel)} />
      <Button variant="primary" isDisabled={busy || selected === null && !text.trim()} onClick={() => void finish(false)} label={t($ => $.human.submit)} />
    </Stack>
  </Dialog>
}
