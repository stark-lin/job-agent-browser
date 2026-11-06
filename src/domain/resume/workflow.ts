/** Stable business sequence shared by the controller and external workflow documentation. */
export const resumeStages = ['optimize'] as const
export const resumeReadTools = ['resume.get_context', 'resume.list_facts'] as const
export const resumeSubmitTools = ['resume.submit_optimization'] as const
