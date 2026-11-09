import type { composeBackend } from '../database/backend'
import type { JsonSchema } from '../../shared/tools/tool.types'
import { businessTool } from './business'
import { profileSchemas as schemas } from './profile-schema'

const retry = ' Use a UUID v4 requestId; retry an uncertain result only with the identical request. For updates and item/fact additions, read profile.get for its revision and pass expectedRevision. A version conflict requires rereading and reconciling, never a blind overwrite.'
const skillGrouping = ' For SKILL facts, preserve each source category or grouped statement as one fact with its label and full technology list (e.g. "Backend skills: SQLite / Go / REST APIs"). Do not split on slashes, commas, semicolons or line wraps, duplicate a group as individual technology facts, or merge distinct source groups. This applies to both item-level and profile-level skills.'
export function createProfileTools(backend: ReturnType<typeof composeBackend>) {
  const bind = (name: string, description: string, schema: JsonSchema, operation: (input: Record<string, unknown>) => unknown) =>
    businessTool(backend, name, description + retry, schema, true, operation, 262144)
  return [
    bind('profile.create', 'Create a saved profile from structured, user-supplied details. No parsing or AI calls. No expectedRevision is needed for creation.', schemas.create, input => backend.profileWrites.create(input)),
    bind('profile.update', 'Patch specified profile fields only. Omitted fields are preserved; empty strings/arrays clear values. Arrays replace in full.', schemas.update, input => backend.profileWrites.update(input)),
    businessTool(backend, 'profile.list_items', 'List education, experience and project items belonging to a profile. Page until all requested items are read.', schemas.items, false, input => backend.profiles.listItems(input as { profileId: string }), 65536),
    bind('profile.add_item', 'Add an education, experience or project item. The optional parent must belong to this profile.', schemas.addItem, input => backend.profileWrites.addItem(input)),
    bind('profile.update_item', 'Patch an item in this profile. Omitted fields stay unchanged; metadata merges by field, arrays replace. Type is immutable; null parentItemId detaches.', schemas.updateItem, input => backend.profileWrites.updateItem(input)),
    bind('profile.add_fact', 'Add a fact to this profile, optionally attached to one of its items. Save supported content and tags; the server does not verify truth.' + skillGrouping, schemas.addFact, input => backend.profileWrites.addFact(input)),
    bind('profile.update_fact', 'Patch a fact in this profile. Omitted fields and its item association stay unchanged; null profileItemId detaches. Arrays replace.' + skillGrouping, schemas.updateFact, input => backend.profileWrites.updateFact(input))
  ]
}
