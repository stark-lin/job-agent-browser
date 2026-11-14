import { Button, Heading, Section, Stack } from '@astryxdesign/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemInput } from '../../domain/candidate/candidate.types'
import type { ResumeDocument, ResumeEntry, ResumeStatement } from '../../domain/resume/resume.types'
import { EditorDialog, ItemCard } from '../../app/profile-editor/EditorComponents'
import { ContactFields, ItemFields, StatementField } from '../../app/profile-editor/ProfileFields'


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
  function close() { setItem(null); setText(null); onEditing(false) }
  function editText(target: TextEdit) { setText(target); onEditing(true) }
  function setStatements(group: TextEdit['group'], parent: string | undefined, update: (blocks: ResumeStatement[]) => ResumeStatement[]) {
    if (group === 'summary') onChange({ ...value, summary: update(value.summary ? [value.summary] : [])[0] ?? null })
    else if (group === 'skills') onChange({ ...value, skills: update(value.skills) })
    else onChange({ ...value, [group]: value[group].map(entry => entry.profileItemId === parent ? { ...entry, bullets: update(entry.bullets) } : entry) })
  }
  function save() {
    if (item) {
      const entry = item.value, metadata = entry.metadata ?? {}
      onChange({ ...value, [item.group]: value[item.group].map(original => original.profileItemId !== item.id ? original : {
        ...original, title: entry.title, organization: entry.organization ?? '', role: entry.role ?? '', location: entry.location ?? '',
        startDate: metadata.startDateText ?? '', endDate: metadata.endDateText ?? '', isCurrent: metadata.isCurrent ?? false,
        degree: metadata.degree ?? '', major: metadata.major ?? '', gpa: metadata.gpa ?? '', url: metadata.url ?? ''
      }) })
    }
    if (text) {
      setStatements(text.group, text.parent, blocks => {
        if (!text.text.trim() && text.group === 'summary') return []
        return text.id ? blocks.map(block => block.id === text.id ? { ...block, text: text.text } : block)
          : [...blocks, { id: crypto.randomUUID(), text: text.text, factIds: [] }]
      })
    }
    close()
  }
  function renderStatements(group: TextEdit['group'], blocks: ResumeStatement[], label: string, parent?: string) {
    return <div className="profile-facts">
      {blocks.map(block => <Section key={block.id} className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{block.text}</Heading></summary>
      <div className="feature-section-body">
        <Stack className="action-row" direction="horizontal" justify="end" align="center" gap={2} wrap="wrap">
          <Button isDisabled={disabled} onClick={() => editText({ group, parent, id: block.id, text: block.text })} label={t($ => $.profile.edit)} />
          <Button isDisabled={disabled} variant="destructive" onClick={() => setStatements(group, parent, rows => rows.filter(row => row.id !== block.id))} label={t($ => $.profile.remove)} />
        </Stack>
      </div></details></Section>)}
      {(group !== 'summary' || !blocks.length) && <Button variant="secondary" isDisabled={disabled}
        onClick={() => editText({ group, parent, text: '' })} className="add-record" label={label} />}
    </div>
  }
  return <div className="profile-stack">
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.basic)}</Heading></summary>
      <div className="feature-section-body"><div className="profile-stack">
      <ContactFields value={value.basics} disabled={disabled} onChange={basics => onChange({ ...value, basics })} />
    </div></div></details></Section>
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.introduction)}</Heading></summary>
      <div className="feature-section-body">{renderStatements('summary', value.summary ? [value.summary] : [], t($ => $.profile.add))}</div></details></Section>
    {(Object.keys(sections) as Group[]).map(group => value[group].length > 0 && <section key={group} className="profile-stack" aria-label={t($ => $.profile.types[sections[group]])}>
      <h2 className="profile-group-heading">{t($ => $.profile.types[sections[group]])}</h2>
      {value[group].map(entry => {
        const id = entry.profileItemId, fields = entryFields(entry, sections[group])
        return <ItemCard key={id} value={fields} disabled={disabled} onEdit={() => { setItem({ group, id, value: fields }); onEditing(true) }}>
          {renderStatements(group, entry.bullets, t($ => $.resume.addBullet), id)}
        </ItemCard>
      })}
    </section>)}
    <Section className="feature-section" padding={0}><details open onInvalidCapture={event => { event.currentTarget.open = true }}>
      <summary><Heading level={2}>{t($ => $.profile.kinds.SKILL)}</Heading></summary>
      <div className="feature-section-body">{renderStatements('skills', value.skills, t($ => $.profile.add))}</div></details></Section>
    <EditorDialog open={Boolean(item || text)} disabled={disabled} onClose={close} onSave={save}>
      {item && <ItemFields resume value={item.value} disabled={disabled} onChange={value => setItem({ ...item, value })} />}
      {text && <StatementField value={text.text} disabled={disabled} onChange={value => setText({ ...text, text: value })} />}
    </EditorDialog>
  </div>
}
