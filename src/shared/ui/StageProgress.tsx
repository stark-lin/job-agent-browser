export function StageProgress({ stages, current, complete, label }: { stages: { id: string; label: string }[]; current: string; complete: boolean; label: string }) {
  const index = stages.findIndex(stage => stage.id === current)
  return <ol className="ui-stage-progress" aria-label={label}>{stages.map((stage, position) => <li key={stage.id}
    className={complete || position < index ? 'is-done' : position === index ? 'is-current' : ''} aria-current={!complete && stage.id === current ? 'step' : undefined}>{stage.label}</li>)}</ol>
}
