import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemInput } from '../../domain/candidate/candidate.types'
import type { ResumeDocument, ResumeEntry, ResumeStatement } from '../../domain/resume/resume.types'
import { importItemDetails, validateItemDates } from '../../domain/candidate/candidate.validation'
import { EditorDialog, ItemCard } from '../../app/profile-editor/EditorComponents'
import { ContactFields, ItemFields, StatementField } from '../../app/profile-editor/ProfileFields'
import { ActionRow, Button, SectionCard } from '../../shared/ui'

const sections = { experience: 'EXPERIENCE', projects: 'PROJECT', education: 'EDUCATION' } as const
type Group = keyof typeof sections
type EntryEdit = { group: Group; id: string; value: ItemInput }
type TextEdit = { group: Group | 'skills' | 'summary'; parent?: string; id?: string; text: string }
function entryFields(entry: ResumeEntry, type: ItemInput['type']): ItemInput {
  return { type, title: entry.title, organization: entry.organization, role: entry.role, location: entry.location,
    metadata: { startDateText: entry.startDate, endDateText: entry.endDate, isCurrent: entry.isCurrent,
      degree: entry.degree, major: entry.major, gpa: entry.gpa, url: entry.url } }
}

export function ResumeEditor({ value, disabled, onChange, onEditing }: {
  value: ResumeDocument; disabled: boolean; onChange(next: ResumeDocument): void; onEditing(open: boolean): void
}) {
  const { t } = useTranslation()
  const [item, setItem] = useState<EntryEdit | null>(null), [text, setText] = useState<TextEdit | null>(null)
  const [invalid, setInvalid] = useState(false)
  function close() { setItem(null); setText(null); setInvalid(false); onEditing(false) }
  function editText(target: TextEdit) { setText(target); onEditing(true) }
  function setStatements(group: TextEdit['group'], parent: string | undefined, update: (blocks: ResumeStatement[]) => ResumeStatement[]) {
    if (group === 'summary') onChange({ ...value, summary: update(value.summary ? [value.summary] : [])[0] ?? null })
    else if (group === 'skills') onChange({ ...value, skills: update(value.skills) })
    else onChange({ ...value, [group]: value[group].map(entry => entry.profileItemId === parent ? { ...entry, bullets: update(entry.bullets) } : entry) })
  }
  function save() {
    if (item) {
      try {
        const entry = importItemDetails(item.value), metadata = entry.metadata
        validateItemDates(entry)
        onChange({ ...value, [item.group]: value[item.group].map(original => original.profileItemId !== item.id ? original : {
          ...original, title: entry.title, organization: entry.organization, role: entry.role, location: entry.location,
          startDate: metadata.startDateText ?? '', endDate: metadata.endDateText ?? '', isCurrent: metadata.isCurrent ?? false,
          degree: metadata.degree ?? '', major: metadata.major ?? '', gpa: metadata.gpa ?? '', url: metadata.url ?? ''
        }) })
      } catch { setInvalid(true); return }
    }
    if (text) {
      if (!text.text.trim() && text.group !== 'summary') { setInvalid(true); return }
      setStatements(text.group, text.parent, blocks => {
        if (!text.text.trim()) return []
        return text.id ? blocks.map(block => block.id === text.id ? { ...block, text: text.text } : block)
          : [...blocks, { id: crypto.randomUUID(), text: text.text, factIds: [] }]
      })
    }
    close()
  }
  function renderStatements(group: TextEdit['group'], blocks: ResumeStatement[], label: string, parent?: string) {
    return <div className="profile-facts">
      {blocks.map(block => <SectionCard key={block.id} title={block.text}>
        <ActionRow>
          <Button disabled={disabled} onClick={() => editText({ group, parent, id: block.id, text: block.text })}>{t($ => $.profile.edit)}</Button>
          <Button disabled={disabled} variant="danger" onClick={() => setStatements(group, parent, rows => rows.filter(row => row.id !== block.id))}>{t($ => $.profile.remove)}</Button>
        </ActionRow>
      </SectionCard>)}
      {(group !== 'summary' || !blocks.length) && <Button variant="add-card" disabled={disabled}
        onClick={() => editText({ group, parent, text: '' })}>{label}</Button>}
    </div>
  }
  return <div className="profile-stack">
    <SectionCard title={t($ => $.profile.basic)}><div className="profile-stack">
      <ContactFields value={value.basics} disabled={disabled} onChange={basics => onChange({ ...value, basics })} />
    </div></SectionCard>
    <SectionCard title={t($ => $.profile.introduction)}>{renderStatements('summary', value.summary ? [value.summary] : [], t($ => $.profile.add))}</SectionCard>
    {(Object.keys(sections) as Group[]).map(group => value[group].length > 0 && <section key={group} className="profile-stack" aria-label={t($ => $.profile.types[sections[group]])}>
      <h2 className="profile-group-heading">{t($ => $.profile.types[sections[group]])}</h2>
      {value[group].map(entry => {
        const id = entry.profileItemId, fields = entryFields(entry, sections[group])
        return <ItemCard key={id} value={fields} disabled={disabled} onEdit={() => { setItem({ group, id, value: fields }); onEditing(true) }}>
          {renderStatements(group, entry.bullets, t($ => $.resume.addBullet), id)}
        </ItemCard>
      })}
    </section>)}
    <SectionCard title={t($ => $.profile.kinds.SKILL)}>{renderStatements('skills', value.skills, t($ => $.profile.add))}</SectionCard>
    <EditorDialog open={Boolean(item || text)} disabled={disabled} invalid={invalid} onClose={close} onSave={save}>
      {item && <ItemFields resume value={item.value} disabled={disabled} onChange={value => { setItem({ ...item, value }); setInvalid(false) }} />}
      {text && <StatementField value={text.text} disabled={disabled} onChange={value => { setText({ ...text, text: value }); setInvalid(false) }} />}
    </EditorDialog>
  </div>
}
