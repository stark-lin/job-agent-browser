/** Ask capabilities are opt-in. Shared with the Server; discovery never grants authority. */
export const askToolAllowlist = [
  'job.list', 'job.get', 'job.import', 'job.update', 'job.set_archived',
  'profile.list', 'profile.get', 'profile.list_items', 'profile.list_facts', 'profile.create', 'profile.update',
  'profile.add_item', 'profile.update_item', 'profile.add_fact', 'profile.update_fact',
  'application.get', 'application.set_status', 'application.list_events', 'application.add_note',
  'application.schedule_event', 'application.reschedule_event',
  'knowledge.list', 'knowledge.read', 'knowledge.search', 'knowledge.retrieve', 'knowledge.write', 'knowledge.mkdir', 'knowledge.move',
  'memory.list', 'memory.recall', 'memory.read', 'memory.write', 'memory.mkdir', 'artifact.get'
] as const
const allowed = new Set<string>(askToolAllowlist)
export const allowedAskTool = (name: string) => allowed.has(name)
