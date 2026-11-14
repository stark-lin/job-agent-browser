import { Button, Heading, Section, Stack, Text, TextArea } from '@astryxdesign/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import { useNavigation } from '../../app/navigation/navigate'
import type { ApplicationTask } from '../../platform/electron/application-contract'

export function ApplicationAgentPanel({ jobId, onChanged }: { jobId: string; onChanged(): void }) {
  const { t } = useTranslation(), { applicationAgent, data } = useServices(), { openPage } = useNavigation()
  const [model, setModel] = useState<{ provider: string; model: string } | null>(null)
  const [text, setText] = useState(''), [task, setTask] = useState<ApplicationTask | null>(null), [error, setError] = useState(''), [submitting, setSubmitting] = useState(false)
  const taskId = useRef(''), alive = useRef(true), locked = useRef(false), changed = useRef(onChanged), completed = useRef('')
  const shouldPoll = useRef(false)
  changed.current = onChanged
  const busy = submitting || task?.state === 'planning' || task?.state === 'executing'
  useEffect(() => {
    alive.current = true
    void data.settings.get({}).then(result => {
      if (!alive.current || !result.ok) return
      const choice = result.value.ai.default, provider = result.value.ai.providers.find(provider => provider.id === choice?.providerId)
      setModel(choice && provider ? { provider: provider.name, model: choice.modelId } : null)
    }).catch(() => {})
    let polling = false
    const timer = setInterval(() => {
      if (!taskId.current || !shouldPoll.current || polling) return
      polling = true
      void applicationAgent.getTask({ taskId: taskId.current }).then(result => {
        if (!alive.current) return
        if (!result.ok) { setError(result.error); return }
        setTask(result.value)
        if (!['planning', 'executing'].includes(result.value.state)) shouldPoll.current = false
        const version = `${result.value.taskId}:${result.value.state}:${result.value.results.filter(item => item.state === 'succeeded').length}`
        if (['succeeded', 'failed', 'cancelled'].includes(result.value.state) && completed.current !== version) {
          completed.current = version; changed.current()
        }
      }).catch(() => { if (alive.current) setError('STORAGE_UNAVAILABLE') }).finally(() => { polling = false })
    }, 250)
    return () => { alive.current = false; clearInterval(timer); if (taskId.current) void applicationAgent.cancel({ taskId: taskId.current }).catch(() => {}) }
  }, [applicationAgent, data, jobId])
  async function submit() {
    if (locked.current || busy || !text.trim() || !model) return
    locked.current = true; setSubmitting(true); setError('')
    try {
      if (task?.state === 'waiting') {
        const result = await applicationAgent.reply({ taskId: task.taskId, answer: text.trim() })
        if (!result.ok) { if (alive.current) setError(result.error); return }
        if (alive.current) { shouldPoll.current = true; setTask({ ...task, state: 'planning', question: '' }) }
      } else {
        const result = await applicationAgent.start({ jobId, instruction: text.trim() })
        if (!result.ok) { if (alive.current) setError(result.error); return }
        if (!alive.current) { void applicationAgent.cancel(result.value); return }
        taskId.current = result.value.taskId; shouldPoll.current = true
        setTask({ ...result.value, jobId, state: 'planning', results: [], question: '', error: null, retryable: false })
      }
      if (alive.current) setText('')
    } catch { if (alive.current) setError('STORAGE_UNAVAILABLE') }
    finally { locked.current = false; if (alive.current) setSubmitting(false) }
  }
  return <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.applicationAgent.title)}</Heading></summary>
      <div className="feature-section-body">{t($ => $.applicationAgent.help) && <p>{t($ => $.applicationAgent.help)}</p>}<div className="job-stack">
    {model ? <Text as="p" type="supporting" role="status">{t($ => $.jobs.selectedModel, model)}</Text> : <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Text as="p" type="supporting" role="status">{t($ => $.applicationAgent.configure)}</Text><Button onClick={() => void openPage('settings')} label={t($ => $.navigation.openSettings)} /></Stack>}
    {task?.question && <Text as="p" type="supporting" role="status">{task.question}</Text>}
    <form className="job-stack" onSubmit={event => { event.preventDefault(); void submit() }}>
      <TextArea label={t($ => $.applicationAgent[task?.state === 'waiting' ? 'answer' : 'instruction'])} htmlName="applicationInstruction" value={text} ref={input => { if (input) input.maxLength = 10000 }} isDisabled={busy} onChange={event => setText(event)} />
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button type="submit" isDisabled={busy || !text.trim() || !model} label={t($ => $.applicationAgent.submit)} />
        {busy && <Button onClick={() => { if (taskId.current) void applicationAgent.cancel({ taskId: taskId.current }).catch(() => setError('STORAGE_UNAVAILABLE')) }} label={t($ => $.applicationAgent.cancel)} />}
        {task?.retryable && <Button isDisabled={busy} onClick={() => { void applicationAgent.retry({ taskId: task.taskId }).then(result => { if (!alive.current) return; if (!result.ok) setError(result.error); else { shouldPoll.current = true; setTask({ ...task, state: 'executing', retryable: false }) } }).catch(() => { if (alive.current) setError('STORAGE_UNAVAILABLE') }) }} label={t($ => $.applicationAgent.retry)} />}</Stack>
    </form>
    {task && <Text as="p" type="supporting" role="status">{t($ => $.applicationAgent.states[task.state])}</Text>}
    {task?.results.map((result, index) => <Text key={index}  as="p" type="supporting" role="status">{t($ => $.applicationAgent.actions[result.type])}: {t($ => $.applicationAgent.results[result.state])}</Text>)}
    {(error || task?.error) && <Text as="p" type="supporting" role="alert" className="error-message">{t($ => $.applicationAgent.failed, { code: error || task?.error || '' })}</Text>}
  </div></div></details></Section>
}
