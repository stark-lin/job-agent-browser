/** Stable business sequence shared by the controller and external workflow documentation. */
export const resumeStages = ['score', 'gate', 'select', 'draft', 'polish'] as const
export const resumeReadTools = ['resume.get_context', 'resume.list_facts'] as const
export const resumeSubmitTools = ['resume.submit_scores', 'resume.submit_gate', 'resume.submit_selection', 'resume.submit_draft', 'resume.submit_polished'] as const
