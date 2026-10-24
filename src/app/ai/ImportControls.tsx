import { useTranslation } from 'react-i18next'
import { DetailsList, FormField, Select, StatusMessage } from '../../shared/ui'
import type { ImportMode, ImportGroupProgress } from '../../shared/import'

export function ImportModeField({ value, onChange, allowed, disabled }: {
  value: ImportMode; onChange: (mode: ImportMode) => void; allowed: boolean; disabled: boolean
}) {
  const { t } = useTranslation()
  return <FormField label={t($ => $.imports.mode)} help={t($ => $.imports[allowed ? 'parallelHelp' : 'enableHelp'])}>{props => <Select {...props}
    name="importMode" disabled={disabled} value={allowed ? value : 'single'} onChange={event => onChange(event.target.value as ImportMode)}>
    <option value="single">{t($ => $.imports.single)}</option><option value="parallel" disabled={!allowed}>{t($ => $.imports.parallel)}</option>
  </Select>}</FormField>
}
export function ImportProgress({ groups }: { groups: ImportGroupProgress[] }) {
  const { t } = useTranslation()
  if (!groups.length) return null
  return <div>
    <StatusMessage>{t($ => $.imports.progress, { completed: groups.filter(group => group.state === 'completed').length, total: groups.length })}</StatusMessage>
    <DetailsList items={groups.map(group => ({ label: t($ => $.imports.groups[group.id]), value: t($ => $.imports.groupState, {
      state: t($ => $.imports.states[group.state]), elapsed: (group.elapsedMs / 1000).toFixed(1), queued: (group.queueMs / 1000).toFixed(1)
    }) }))} />
  </div>
}
