import * as v from '../common/validation'
import { fail } from '../common/errors'
import { applicationStatuses } from '../job/job.types'
import { parseJobChanges } from '../job/workflow'
import type { ApplicationAction, ApplicationPlan } from './application.types'

function action(value: unknown): ApplicationAction {
  if (!value || typeof value !== 'object' || !('type' in value)) fail('INVALID_INPUT')
  switch (value.type) {
    case 'set_status': return v.object({ type: v.choice(['set_status']), status: v.choice(applicationStatuses) })(value)
    case 'add_note': return v.object({ type: v.choice(['add_note']), text: v.text(20000, 1) })(value)
    case 'schedule_event': return v.object({ type: v.choice(['schedule_event']), eventType: v.choice(['INTERVIEW', 'DEADLINE', 'FOLLOW_UP']),
      title: v.text(500, 1), description: v.optionalText(20000), startsAt: v.timestamp, endsAt: v.optional(v.nullable(v.timestamp), null) })(value)
    case 'reschedule_event': return v.object({ type: v.choice(['reschedule_event']), eventId: v.id, startsAt: v.timestamp, endsAt: v.optional(v.nullable(v.timestamp), null) })(value)
    case 'update_job': return v.object({ type: v.choice(['update_job']), changes: parseJobChanges })(value)
    case 'set_archived': return v.object({ type: v.choice(['set_archived']), archived: v.boolean })(value)
    default: return fail('INVALID_INPUT')
  }
}
export function parseApplicationPlan(value: unknown): ApplicationPlan {
  const plan = v.object({ question: v.text(4000), actions: v.array(action, 10) })(value)
  if (Boolean(plan.question.trim()) === Boolean(plan.actions.length)) fail('INVALID_INPUT')
  return plan
}
