import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServices } from '../../app/providers'
import type { Preferences } from '../../shared/settings'
import { ActionRow, Button, Checkbox, ChoiceCard, FormField, LanguageBackground, QuietPanel, Radio, Select, StageProgress, StatusMessage, TextInput, WizardCard } from '../../shared/ui'
import { useOnboardingModel } from './useOnboardingModel'
import { OnboardingAgents, useOnboardingAgents } from './OnboardingAgents'
import { OnboardingProfile, useOnboardingProfile } from './OnboardingProfile'
import './onboarding.css'

type Step = 'appearance' | 'choice' | 'model' | 'agent' | 'profile' | 'ready'
export function OnboardingPage({ preferences, onComplete }: { preferences: Preferences; onComplete(value: Preferences): void }) {
  const { t, i18n } = useTranslation(), { data } = useServices()
  const [step, setStep] = useState<Step>('appearance'), [language, setLanguage] = useState(preferences.language), [theme, setTheme] = useState(preferences.theme)
  const [useModel, setUseModel] = useState(true), [useAgent, setUseAgent] = useState(false)
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), lock = useRef(false)
  const model = useOnboardingModel(preferences), agents = useOnboardingAgents(), profile = useOnboardingProfile(model.choice)
  const steps: Step[] = ['appearance', 'choice', ...(useModel ? ['model' as const] : []), ...(useAgent ? ['agent' as const] : []), 'profile', 'ready']
  const index = steps.indexOf(step), busy = saving || model.busy || agents.busy || profile.busy
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
      if (step === 'model' && !await model.run('save')) return
      if (step === 'ready') {
        const result = await data.settings.savePreferences({ onboardingCompleted: true })
        if (!result.ok) throw new Error(t($ => $.settings.saveFailed))
        onComplete(result.value); return
      }
      move(steps[index + 1])
    } catch (reason) { setError(reason instanceof Error ? reason.message : t($ => $.settings.saveFailed)) }
    finally { lock.current = false; setSaving(false) }
  }
  const nextDisabled = busy || (step === 'choice' && !useModel && !useAgent) || (step === 'model' && !model.ready) || (step === 'agent' && !agents.ready)
  return <main className="onboarding-page" aria-label={t($ => $.onboarding.setup)}><div className="onboarding-stage">
    <StageProgress label={t($ => $.onboarding.setup)} stages={steps.map(id => ({ id, label: t($ => $.onboarding[id]) }))}
      current={step} complete={false} disabled={busy} onNavigate={id => move(id as Step)} />
    <WizardCard title={t($ => $.onboarding[step])} footer={<>
      <ActionRow>{index > 0 && <Button variant="ghost" disabled={busy} onClick={() => move(steps[index - 1])}>{t($ => $.onboarding.back)}</Button>}
        {['model', 'agent', 'profile'].includes(step) && <Button variant="ghost" disabled={busy} onClick={() => move(steps[index + 1])}>{t($ => $.onboarding.skip)}</Button>}
        {step === 'choice' && <Button variant="ghost" disabled={busy} onClick={() => { setUseModel(false); setUseAgent(false); move('profile') }}>{t($ => $.onboarding.later)}</Button>}
      </ActionRow>
      <ActionRow><Button data-onboarding-next variant="primary" disabled={nextDisabled} onClick={() => void forward()}>{t($ => step === 'ready' ? $.onboarding.finish : $.onboarding.next)}</Button></ActionRow>
    </>}>
      <div className="onboarding-step" hidden={step !== 'appearance'}><LanguageBackground language={language} theme={theme} disabled={busy}
        labels={{ language: t($ => $.onboarding.language), background: t($ => $.onboarding.background), system: t($ => $.onboarding.system), light: t($ => $.onboarding.light), dark: t($ => $.onboarding.dark) }}
        onLanguageChange={value => { setLanguage(value); void i18n.changeLanguage(value) }} onThemeChange={value => { setTheme(value); if (value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = value }} /></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'choice'}>
        <ChoiceCard title={t($ => $.onboarding.chooseModel)} description={t($ => $.onboarding.modelDescription)} selected={useModel} onClick={() => setUseModel(value => !value)} />
        <ChoiceCard title={t($ => $.onboarding.chooseAgent)} description={t($ => $.onboarding.agentDescription)} selected={useAgent} onClick={() => setUseAgent(value => !value)} />
      </div>
      <div className="onboarding-step onboarding-fields" hidden={step !== 'model'}>
        <FormField label={t($ => $.onboarding.provider)}>{props => <Select {...props} disabled={busy} value={model.kind} onChange={e => model.changeProvider(e.target.value)}>
          <option value="openai">{t($ => $.onboarding.openai)}</option><option value="local">{t($ => $.onboarding.local)}</option><option value="custom">{t($ => $.onboarding.custom)}</option>
        </Select>}</FormField>
        <FormField label="Endpoint">{props => <TextInput {...props} type="url" maxLength={2048} disabled={busy} value={model.endpoint} onChange={e => model.editEndpoint(e.target.value)} />}</FormField>
        <FormField label="API Key">{props => <TextInput {...props} type="password" maxLength={4096} autoComplete="off" disabled={busy} value={model.key} placeholder={t($ => $.onboarding.keyPlaceholder)} onChange={e => model.editKey(e.target.value)} />}</FormField>
        <FormField label={t($ => $.onboarding.defaultModel)}>{props => <div className="onboarding-model-controls"><TextInput {...props} maxLength={200} disabled={busy} value={model.model} placeholder="gpt-4.1" onChange={e => model.editModel(e.target.value)} />
          <Button disabled={busy || !model.valid} onClick={() => void model.run('discover')}>{t($ => $.onboarding.discover)}</Button>
          <Button disabled={busy || !model.ready} onClick={() => void model.run('test')}>{t($ => $.onboarding.test)}</Button></div>}</FormField>
        {model.discovered.length > 0 && <div className="onboarding-results"><div className="onboarding-result-head"><span>{t($ => $.onboarding.foundModels, { count: model.discovered.length })}</span><span>{t($ => $.onboarding.defaultLabel)}</span></div>
          {model.discovered.map(id => <QuietPanel key={id} className="onboarding-model-option"><Checkbox label={id} checked={model.selected.includes(id)} disabled={busy} onChange={e => model.toggle(id, e.target.checked)} />
            <Radio name="onboarding-default-model" label={model.model === id ? t($ => $.onboarding.defaultLabel) : ''} aria-label={`${t($ => $.onboarding.defaultLabel)}: ${id}`} checked={model.model === id} disabled={busy} onChange={() => { model.editModel(id); model.toggle(id, true) }} /></QuietPanel>)}</div>}
        {model.tested && <StatusMessage tone="success">{t($ => $.settings.connectionOK)}</StatusMessage>}
        {model.error && <StatusMessage tone="error">{model.error}</StatusMessage>}
      </div>
      <div className="onboarding-step" hidden={step !== 'agent'}><OnboardingAgents state={agents} /></div>
      <div className="onboarding-step" hidden={step !== 'profile'}><OnboardingProfile state={profile} model={model.choice} agent={agents.ready} /></div>
      <div className="onboarding-step onboarding-stack" hidden={step !== 'ready'}>
        {([[t($ => $.onboarding.summaryModel), model.configured, false], [t($ => $.onboarding.summaryAgent), agents.ready, false], [t($ => $.onboarding.summaryProfile), profile.saved || profile.pdf.saved || profile.externalConfirmed, true]] as const).map(([label, ready, isProfile]) =>
          <QuietPanel key={label} className="onboarding-summary"><strong>{label}</strong><StatusMessage tone={ready ? 'success' : 'neutral'}>{t($ => isProfile ? ready ? $.onboarding.profileReady : $.onboarding.profilePending : ready ? $.onboarding.configured : $.onboarding.notConfigured)}</StatusMessage></QuietPanel>)}
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </WizardCard>
  </div></main>
}
