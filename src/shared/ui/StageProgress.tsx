import { Button } from './Button'

export function StageProgress({ stages, current, complete, label, onNavigate, disabled }: { stages: { id: string; label: string }[]; current: string; complete: boolean; label: string; onNavigate?(id: string): void; disabled?: boolean }) {
  const index = stages.findIndex(stage => stage.id === current)
  return <ol className={`ui-stage-progress${onNavigate ? ' ui-stage-progress--interactive' : ''}`} aria-label={label}>{stages.map((stage, position) => <li key={stage.id}
    className={complete || position < index ? 'is-done' : position === index ? 'is-current' : ''} aria-current={!complete && stage.id === current ? 'step' : undefined}>{onNavigate
      ? <Button size="sm" variant="ghost" disabled={disabled || position > index} onClick={() => onNavigate(stage.id)}>{stage.label}</Button> : stage.label}</li>)}</ol>
}
