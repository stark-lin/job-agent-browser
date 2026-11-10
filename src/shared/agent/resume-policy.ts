import { knowledgeAgentTools, memoryAgentTools } from './context-policy'
import { toolErrorCodes } from '../tools/errors'

export const resumeAgentTools = [
  'resume.get_context', 'resume.list_facts', 'resume.list_bullets', 'resume.rewrite_bullet',
  ...memoryAgentTools, ...knowledgeAgentTools
] as const

export const resumeAgentLifecycle = ['resume.start', 'resume.attach_agent', 'resume.validate', 'resume.publish', 'resume.fail', 'resume.cancel', 'artifact.build'] as const

export const resumeFailures: readonly string[] = ['AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT',
  'AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_PROTOCOL_ERROR', 'AI_CONNECT_FAILED',
  'STORAGE_UNAVAILABLE', 'STORAGE_BUSY', 'INVALID_INPUT', 'INVALID_STATE', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT',
  'ASK_CONTEXT_UNKNOWN', 'ASK_CONTEXT_TOO_SMALL', 'ASK_CONTEXT_OVERFLOW', ...toolErrorCodes, 'VALIDATION_FAILED', 'GENERATION_FAILED']
