export const resumeAgentTools = [
  'resume.get_context', 'resume.list_facts', 'resume.list_bullets', 'resume.rewrite_bullet',
  'memory.read', 'memory.recall', 'knowledge.list', 'knowledge.read', 'knowledge.search', 'knowledge.retrieve'
] as const

export const resumeAgentLifecycle = ['resume.start', 'resume.attach_agent', 'resume.validate', 'resume.publish', 'resume.fail', 'resume.cancel', 'artifact.build'] as const

export const resumeFailures: readonly string[] = ['AGENT_PROTOCOL_ERROR', 'AGENT_STEP_LIMIT', 'AGENT_TIMEOUT',
  'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_CONNECT_FAILED', 'AUDIT_UNAVAILABLE',
  'ASK_CONTEXT_UNKNOWN', 'ASK_CONTEXT_TOO_SMALL', 'ASK_CONTEXT_OVERFLOW', 'TOOL_GUARD_TERMINATED', 'VALIDATION_FAILED']
