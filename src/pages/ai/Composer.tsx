import { Button, Icon, TextArea } from '@astryxdesign/core'
import { ChatComposer } from '@astryxdesign/core/Chat'
import { useTranslation } from 'react-i18next'
import { ModelPicker } from './ModelPicker'
import type { AIChoice, AISettings } from '../../shared/ai'
import { ASK_MESSAGE_LIMIT } from '../../shared/browser-selection'

export function Composer({ text, setText, busy, sending, valid, choice, config, onChoice, send, stop }: {
  text: string; setText(text: string): void; busy: boolean; sending: boolean; valid: boolean; choice: AIChoice | null; config: AISettings | null
  onChoice(choice: AIChoice): void; send(): void; stop(): void
}) {
  const { t } = useTranslation()
  const canSend = valid && Boolean(text.trim()) && !sending
  const submit = () => { if (canSend) send() }

  return <ChatComposer className="ai-composer" density="compact" value={text} onChange={setText} onSubmit={submit}
    input={<TextArea label={t($ => $.ask.message)} isLabelHidden placeholder={t($ => $.ask.placeholder)}
      value={text} ref={input => { if (input) input.maxLength = ASK_MESSAGE_LIMIT }} onChange={setText} rows={3} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault()
          submit()
        }
      }} />}
    footerActions={<ModelPicker config={config} choice={choice} busy={busy || sending} onChange={onChoice} />}
    sendActions={busy && <Button size="sm" label={t($ => $.ask.stop)} isIconOnly icon={<Icon icon="stop" />} tooltip={t($ => $.ask.stop)} onClick={stop} />}
    sendButton={<Button size="sm" label={t($ => $.ask.send)} isIconOnly icon={<Icon icon="arrowUp" />} tooltip={t($ => $.ask.send)} variant="primary" isDisabled={!canSend} onClick={submit} />} />
}
