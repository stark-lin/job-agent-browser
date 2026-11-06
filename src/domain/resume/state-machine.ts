import { fail } from '../common/errors'
import type { GenerationRun, ResumeRunState } from './resume.types'

const next: Partial<Record<ResumeRunState, ResumeRunState>> = {
  CREATED: 'COPYING', COPYING: 'REWRITING', REWRITING: 'VALIDATING', VALIDATING: 'PUBLISHING', PUBLISHING: 'PUBLISHED'
}
export const isGenerating = (state: ResumeRunState) => Object.hasOwn(next, state)
export function transition(run: GenerationRun, state: ResumeRunState, now: string, error: string | null = null) {
  if (!isGenerating(run.state) || next[run.state] !== state && !['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(state)) fail('INVALID_STATE')
  run.state = state
  run.stateVersion++
  run.updatedAt = now
  run.error = error
  if (!isGenerating(state)) run.finishedAt = now
}
