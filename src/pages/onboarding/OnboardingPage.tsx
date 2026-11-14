import { Button, Card, Heading, Section, SegmentedControl, SegmentedControlItem, SelectableCard, Stack, Step, Stepper, Text } from '@astryxdesign/core'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { useServices } from '../../app/providers'
import type { Preferences } from '../../shared/settings'
import { AIConnectionEditor } from '../../app/ai/AIConnectionEditor'
import { OnboardingAgents, useOnboardingAgents } from './OnboardingAgents'
import { OnboardingProfile, useOnboardingProfile } from './OnboardingProfile'
import './onboarding.css'

type Step = 'appearance' | 'choice' | 'model' | 'agent' | 'profile' | 'ready'
export function OnboardingPage({ preferences, onComplete }: { preferences: Preferences; onComplete(value: Preferences): void }) {
  const { t, i18n } = useTranslation(), { data } = useServices()
  const [step, setStep] = useState<Step>('appearance'), [language, setLanguage] = useState(preferences.language), [theme, setTheme] = useState(preferences.theme)
  const [useModel, setUseModel] = useState(true), [useAgent, setUseAgent] = useState(false)
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), lock = useRef(false)
  const [ai, setAI] = useState(preferences.ai), [modelBusy, setModelBusy] = useState(false)
  const providerId = ai.default?.providerId ?? ai.providers[0]?.id ?? 'onboarding-openai'
  const agents = useOnboardingAgents(), profile = useOnboardingProfile(ai.default)
  const steps: Step[] = ['appearance', 'choice', ...(useModel ? ['model' as const] : []), ...(useAgent ? ['agent' as const] : []), 'profile', 'ready']
  const index = steps.indexOf(step), busy = saving || modelBusy || agents.busy || profile.busy
  function move(next: Step) { setError(''); setStep(next) }
  async function saveAppearance() {
    const result = await data.settings.savePreferences({ language, theme })
    if (!result.ok) throw new Error(t($ => $.settings.saveFailed))
  }
  async function forward() {
    if (lock.current || busy) return
    lock.current = true; setSaving(true); setError('')
    try {
      if (step === 'appearance') await saveAppearance()
      if (step === 'ready') {
        const result = await data.settings.savePreferences({ onboardingCompleted: true })
        if (!result.ok) throw new Error(t($ => $.settings.saveFailed))
        onComplete(result.value); return
      }
      move(steps[index + 1])
    } catch (reason) { setError(reason instanceof Error ? reason.message : t($ => $.settings.saveFailed)) }
    finally { lock.current = false; setSaving(false) }
  }
  const nextDisabled = busy || (step === 'choice' && !useModel && !useAgent) || (step === 'agent' && !agents.ready)
  return <Theme theme={neutralTheme} mode={theme}><main className="onboarding-page" aria-label={t($ => $.onboarding.setup)}><div className="onboarding-stage">
    <Stepper data-onboarding-steps label={t($ => $.onboarding.setup)} activeStep={index} density="compact" onStepClick={position => move(steps[position])}>
      {steps.map((id, position) => <Step key={id} step={position} label={t($ => $.onboarding[id])} isDisabled={busy || position > index} />)}
    </Stepper>
    <Card className="onboarding-card" padding={6}>
      <Heading level={1}>{t($ => step === 'model' ? $.connection.title : $.onboarding[step])}</Heading>
      <div className="onboarding-body">
      <div className="onboarding-step" hidden={step !== 'appearance'}><Stack gap={4}>
            <Stack gap={1}>
              <Text type="label">{t($ => $.onboarding.language)}</Text>
              <SegmentedControl label={t($ => $.onboarding.language)} value={language} isDisabled={busy}
                onChange={value => { if (value === 'zh-CN' || value === 'en') { setLanguage(value); void i18n.changeLanguage(value) } } }>
                <SegmentedControlItem value="zh-CN" label="简体中文" />
                <SegmentedControlItem value="en" label="English" />
              </SegmentedControl>
            </Stack>
            <Stack gap={1}>
              <Text type="label">{t($ => $.onboarding.background)}</Text>
              <SegmentedControl label={t($ => $.onboarding.background)} value={theme} isDisabled={busy}
                onChange={value => { if (value === 'light' || value === 'dark' || value === 'system') setTheme(value) } }>
                {(['system', 'light', 'dark'] as const).map(mode =>
                  <SegmentedControlItem key={mode} value={mode} label={t($ => $.onboarding[mode])} />)}
              </SegmentedControl>
            </Stack>
          </Stack></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'choice'}>
        <SelectableCard label={t($ => $.onboarding.chooseModel)} isSelected={useModel} onChange={setUseModel}><strong>{t($ => $.onboarding.chooseModel)}</strong><Text as="p" type="supporting">{t($ => $.onboarding.modelDescription)}</Text></SelectableCard>
        <SelectableCard label={t($ => $.onboarding.chooseAgent)} isSelected={useAgent} onChange={setUseAgent}><strong>{t($ => $.onboarding.chooseAgent)}</strong><Text as="p" type="supporting">{t($ => $.onboarding.agentDescription)}</Text></SelectableCard>
      </div>
      <div className="onboarding-step" hidden={step !== 'model'}>
        <AIConnectionEditor settings={ai} providerId={providerId} disabled={saving || agents.busy || profile.busy}
          submitLabel={t($ => $.onboarding.next)} onBusy={setModelBusy} onSaved={value => { setAI(value.ai); move(steps[index + 1]) }} />
      </div>
      <div className="onboarding-step" hidden={step !== 'agent'}><OnboardingAgents state={agents} /></div>
      <div className="onboarding-step" hidden={step !== 'profile'}><OnboardingProfile state={profile} model={ai.default} agent={agents.ready} /></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'ready'}>
        {([[t($ => $.onboarding.summaryModel), Boolean(ai.default), false], [t($ => $.onboarding.summaryAgent), agents.ready, false], [t($ => $.onboarding.summaryProfile), profile.saved || profile.pdf.saved || profile.externalConfirmed, true]] as const).map(([label, ready, isProfile]) =>
          <Section key={label} className="onboarding-summary" variant="muted" padding={3}><strong>{label}</strong><Text as="p" type="supporting" role="status">{t($ => isProfile ? ready ? $.onboarding.profileReady : $.onboarding.profilePending : ready ? $.onboarding.configured : $.onboarding.notConfigured)}</Text></Section>)}
      </div>
      {error && <Text as="p" type="supporting" role="alert" className="error-message">{error}</Text>}
    </div>
      <footer className="onboarding-footer">
      <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">{index > 0 && <Button variant="ghost" isDisabled={busy} onClick={() => move(steps[index - 1])} label={t($ => $.onboarding.back)} />}
        {['model', 'agent', 'profile'].includes(step) && <Button variant="ghost" isDisabled={busy} onClick={() => move(steps[index + 1])} label={t($ => $.onboarding.skip)} />}
        {step === 'choice' && <Button variant="ghost" isDisabled={busy} onClick={() => { setUseModel(false); setUseAgent(false); move('profile') }} label={t($ => $.onboarding.later)} />}
      </Stack>
      {step !== 'model' && <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap"><Button data-onboarding-next variant="primary" isDisabled={nextDisabled} onClick={() => void forward()} label={t($ => step === 'ready' ? $.onboarding.finish : $.onboarding.next)} /></Stack>}
    </footer>
    </Card>
  </div></main></Theme>
}
