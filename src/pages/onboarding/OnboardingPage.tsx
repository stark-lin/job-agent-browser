import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import type { Preferences } from '../../shared/settings'
import { ActionRow, Button, ChoiceCard, LanguageBackground, QuietPanel, StageProgress, StatusMessage, WizardCard } from '../../shared/ui'
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
  return <main className="onboarding-page" aria-label={t($ => $.onboarding.setup)}><div className="onboarding-stage">
    <StageProgress label={t($ => $.onboarding.setup)} stages={steps.map(id => ({ id, label: t($ => $.onboarding[id]) }))}
      current={step} complete={false} disabled={busy} onNavigate={id => move(id as Step)} />
    <WizardCard title={t($ => step === 'model' ? $.connection.title : $.onboarding[step])} footer={<>
      <ActionRow>{index > 0 && <Button variant="ghost" disabled={busy} onClick={() => move(steps[index - 1])}>{t($ => $.onboarding.back)}</Button>}
        {['model', 'agent', 'profile'].includes(step) && <Button variant="ghost" disabled={busy} onClick={() => move(steps[index + 1])}>{t($ => $.onboarding.skip)}</Button>}
        {step === 'choice' && <Button variant="ghost" disabled={busy} onClick={() => { setUseModel(false); setUseAgent(false); move('profile') }}>{t($ => $.onboarding.later)}</Button>}
      </ActionRow>
      {step !== 'model' && <ActionRow><Button data-onboarding-next variant="primary" disabled={nextDisabled} onClick={() => void forward()}>{t($ => step === 'ready' ? $.onboarding.finish : $.onboarding.next)}</Button></ActionRow>}
    </>}>
      <div className="onboarding-step" hidden={step !== 'appearance'}><LanguageBackground language={language} theme={theme} disabled={busy}
        labels={{ language: t($ => $.onboarding.language), background: t($ => $.onboarding.background), system: t($ => $.onboarding.system), light: t($ => $.onboarding.light), dark: t($ => $.onboarding.dark) }}
        onLanguageChange={value => { setLanguage(value); void i18n.changeLanguage(value) }} onThemeChange={value => { setTheme(value); if (value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = value }} /></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'choice'}>
        <ChoiceCard title={t($ => $.onboarding.chooseModel)} description={t($ => $.onboarding.modelDescription)} selected={useModel} onClick={() => setUseModel(value => !value)} />
        <ChoiceCard title={t($ => $.onboarding.chooseAgent)} description={t($ => $.onboarding.agentDescription)} selected={useAgent} onClick={() => setUseAgent(value => !value)} />
      </div>
      <div className="onboarding-step" hidden={step !== 'model'}>
        <AIConnectionEditor settings={ai} providerId={providerId} disabled={saving || agents.busy || profile.busy}
          submitLabel={t($ => $.onboarding.next)} onBusy={setModelBusy} onSaved={value => { setAI(value.ai); move(steps[index + 1]) }} />
      </div>
      <div className="onboarding-step" hidden={step !== 'agent'}><OnboardingAgents state={agents} /></div>
      <div className="onboarding-step" hidden={step !== 'profile'}><OnboardingProfile state={profile} model={ai.default} agent={agents.ready} /></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'ready'}>
        {([[t($ => $.onboarding.summaryModel), Boolean(ai.default), false], [t($ => $.onboarding.summaryAgent), agents.ready, false], [t($ => $.onboarding.summaryProfile), profile.saved || profile.pdf.saved || profile.externalConfirmed, true]] as const).map(([label, ready, isProfile]) =>
          <QuietPanel key={label} className="onboarding-summary"><strong>{label}</strong><StatusMessage tone={ready ? 'success' : 'neutral'}>{t($ => isProfile ? ready ? $.onboarding.profileReady : $.onboarding.profilePending : ready ? $.onboarding.configured : $.onboarding.notConfigured)}</StatusMessage></QuietPanel>)}
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </WizardCard>
  </div></main>
}
