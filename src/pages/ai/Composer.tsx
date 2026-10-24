import { useTranslation } from 'react-i18next'
import { Button, ComposerSurface, TextArea } from '../../shared/ui'
import { ModelPicker } from './ModelPicker'
import type { AIChoice, AISettings } from '../../shared/ai'
export function Composer({ text, setText, busy, sending, valid, choice, config, onChoice, send, stop }: {
  text: string; setText(text: string): void; busy: boolean; sending: boolean; valid: boolean; choice: AIChoice | null; config: AISettings | null
  onChoice(choice: AIChoice): void; send(): void; stop(): void
}) {
  const { t } = useTranslation()
  return <form className="ai-composer" onSubmit={e => { e.preventDefault(); if (!busy && valid && text.trim() && !sending) send() }}>
    <ComposerSurface controls={<><ModelPicker config={config} choice={choice} busy={busy || sending} onChange={onChoice} />
      {busy ? <Button aria-label={t($ => $.ask.stop)} title={t($ => $.ask.stop)} onClick={stop}>■</Button> : <Button variant="primary" type="submit" aria-label={t($ => $.ask.send)} title={t($ => $.ask.send)} disabled={sending || !valid || !text.trim()}>↑</Button>}</>}>
      <TextArea aria-label={t($ => $.ask.message)} placeholder={t($ => $.ask.placeholder)} value={text} maxLength={128000} onChange={e => setText(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!busy && valid && text.trim() && !sending) send() }
      }} />
    </ComposerSurface>
  </form>
}
