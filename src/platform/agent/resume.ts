import { resumeEvidenceRules, resumeIntroductionRules } from './resume-policy'
import type { Artifact, GenerationStage } from '../../domain/resume/resume.types'
import type { AgentTools } from '../../shared/agent'

export type StageRunner = (stage: GenerationStage, instruction: string) => Promise<string>

/** Resume reasoning follows the workflow; every capability crosses MCP. */
export async function runResumeAgent(run: { id: string; config: { targetWordCount: number } }, deps: {
  tools: AgentTools; runner: StageRunner; signal: AbortSignal
  stage(stage: GenerationStage): void
}): Promise<Artifact> {
  const { tools, signal } = deps
  signal.throwIfAborted()
  deps.stage('optimize')
  const result = await deps.runner('optimize', `Run ID: ${run.id}.
Stage: optimize
Read resume.get_context and every page of resume.list_facts for this run.
${resumeEvidenceRules}
${resumeIntroductionRules}
Identify the job's relevant keywords and select and improve supported statements within ${run.config.targetWordCount} words. Count CJK characters individually.
Use the language of the main responsibilities and requirements; if uncertain use en. Each bullet may cite only facts belonging to its entry. Use each earliest source fact as a bullet anchor at most once per entry. Skills may cite only SKILL facts. Omit irrelevant entries. The application copies basic fields and orders the document.
Return only JSON of this exact shape. Replace sample strings with real values:
{"language":"en","summary":{"text":"supported statement","factIds":["source UUID"]},"entries":[{"profileItemId":"UUID","bullets":[{"text":"supported statement","factIds":["source UUID"]}]}],"skills":[]}
summary can be null when no personal introduction exists. Each statement must cite at least one source. Do not return IDs for statements.`)
  signal.throwIfAborted()
  const optimization: unknown = JSON.parse(result)
  deps.stage('assemble')
  signal.throwIfAborted()
  await tools.call('resume.submit_optimization', { runId: run.id, optimization }, signal)
  signal.throwIfAborted()
  deps.stage('publish')
  signal.throwIfAborted()
  return (await tools.call('resume.publish', { runId: run.id }, signal) as { artifact: Artifact }).artifact
}
