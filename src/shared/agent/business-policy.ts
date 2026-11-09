/** Existing native business surface for trusted fixed workflows and external MCP. */
export const jobAgentAllowlist = ['knowledge.list','knowledge.read','knowledge.search','knowledge.retrieve','knowledge.write','knowledge.mkdir','knowledge.move','knowledge.delete', 'job.list', 'job.get', 'job.import', 'job.update', 'job.set_archived',
  'application.get', 'application.set_status', 'application.list_events', 'application.add_note', 'application.schedule_event', 'application.reschedule_event',
  'profile.list', 'profile.get', 'profile.list_facts', 'profile.list_items', 'profile.create', 'profile.update',
  'profile.add_item', 'profile.update_item', 'profile.add_fact', 'profile.update_fact', 'resume.start', 'resume.get_context', 'resume.list_facts',
  'resume.list_bullets', 'resume.rewrite_bullet',
  'resume.publish', 'resume.fail', 'resume.cancel', 'artifact.get', 'artifact.build'] as const
