/** Keep recovery identifiers and outcomes, never business bodies, tool arguments or credentials. */
export function resourceRecord(name: string, args: unknown, result: unknown, uncertain: boolean): string | null {
  if (name.startsWith('tool.') || name.startsWith('memory.')) return null
  const refs: Record<string, unknown> = {}
  const allowed = new Set(['id', 'jobId', 'profileId', 'runId', 'artifactId', 'itemId', 'profileItemId', 'factId', 'requestId', 'revision', 'expectedRevision', 'status', 'factIds', 'itemIds', 'path', 'source', 'target'])
  for (const [label, value] of [['input', args], ['result', result]] as const) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const selected: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value)) if (allowed.has(key) && (typeof raw === 'string' && raw.length <= 256 || typeof raw === 'number' || Array.isArray(raw) && raw.every(v => typeof v === 'string' && v.length <= 256))) selected[key] = raw
    const artifact = (value as Record<string, unknown>).artifact
    if (artifact && typeof artifact === 'object' && 'id' in artifact && typeof artifact.id === 'string' && artifact.id.length <= 256) selected.artifactId = artifact.id
    refs[label] = selected
  }
  if (!uncertain && Object.values(refs).every(value => !Object.keys(value as object).length)) return null
  return JSON.stringify({ tool: name, state: uncertain ? 'uncertain' : result === null ? 'failed' : 'completed', refs })
}

/** Replace resource checkpoints; do not create a second append-only tool activity log. */
export function updateResourceRecords(previous: string[], record: string): string[] {
  const values = new Map<string, string>()
  for (const encoded of [...previous, record]) {
    const value = JSON.parse(encoded) as { tool: string; state: string; refs: { input?: Record<string, unknown>; result?: Record<string, unknown> } }
    const refs = { ...value.refs.input, ...value.refs.result }
    const id = refs.runId ?? refs.jobId ?? refs.profileId ?? refs.artifactId ?? refs.id ?? refs.path ?? refs.target ?? 'current'
    const key = value.state === 'uncertain' ? `uncertain:${value.tool}:${refs.requestId ?? id}` : `${value.tool.split('.')[0]}:${id}`
    const old = values.get(key)
    if (old && value.state !== 'uncertain') {
      const prior = JSON.parse(old) as typeof value
      value.refs = { input: { ...prior.refs.input, ...value.refs.input }, result: { ...prior.refs.result, ...value.refs.result } }
    }
    values.set(key, JSON.stringify(value))
  }
  return [...values.values()]
}
