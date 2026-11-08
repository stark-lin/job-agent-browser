import type { Language, ThemePreference } from '../settings'
import { Button } from './Button'

export function SegmentedControl<T extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: T; options: { value: T; label: string; lang?: string }[]; disabled?: boolean; onChange(value: T): void
}) {
  return <div className="ui-segmented" role="group" aria-label={label}>{options.map(option =>
    <Button key={option.value} lang={option.lang} disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</Button>
  )}</div>
}

export interface LanguageBackgroundLabels { language: string; background: string; system: string; light: string; dark: string }
export function LanguageBackground({ language, theme, labels, disabled, onLanguageChange, onThemeChange }: {
  language: Language; theme: ThemePreference; labels: LanguageBackgroundLabels; disabled?: boolean
  onLanguageChange(value: Language): void; onThemeChange(value: ThemePreference): void
}) {
  return <div className="ui-language-background">
    <div className="ui-field"><span className="ui-field-label">{labels.language}</span>
      <SegmentedControl label={labels.language} value={language} disabled={disabled} onChange={onLanguageChange}
        options={[{ value: 'zh-CN', label: '简体中文', lang: 'zh-CN' }, { value: 'en', label: 'English', lang: 'en' }]} />
    </div>
    <div className="ui-field"><span className="ui-field-label">{labels.background}</span>
      <SegmentedControl label={labels.background} value={theme} disabled={disabled} onChange={onThemeChange}
        options={[{ value: 'system', label: labels.system }, { value: 'light', label: labels.light }, { value: 'dark', label: labels.dark }]} />
    </div>
  </div>
}
