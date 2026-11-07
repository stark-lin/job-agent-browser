import { chatMigration } from './chat'
import { askRuntimeMigration } from './ask-runtime'
import { chatModelRequestsMigration } from './chat-model-requests'
import { chatProtocolMigration } from './chat-protocol'
import { chatReactCyclesMigration, chatReactCycleConstraintsMigration } from './chat-react-cycles'

const tables = [
  ['chat_runs', 'agent_runs'], ['chat_items', 'agent_items'],
  ['chat_provider_responses', 'agent_model_responses'], ['chat_model_requests', 'agent_model_requests'],
  ['chat_react_cycles', 'agent_react_cycles']
] as const
const agentNames = (sql: string) => tables.reduce((value, [old, next]) => value.replaceAll(old, next), sql)
const storage = agentNames(chatMigration.slice(chatMigration.indexOf('CREATE TABLE chat_runs'))
  .replaceAll('session_id TEXT NOT NULL', 'session_id TEXT')
  .replace(' CHECK((state=', ` agent TEXT NOT NULL DEFAULT 'ask' CHECK(agent IN ('ask','resume')),
 source TEXT NOT NULL DEFAULT 'chat',
 CHECK((agent='ask' AND session_id IS NOT NULL AND source IN ('chat','smart-paste'))
    OR (agent='resume' AND session_id IS NULL AND source='resume-generate')),
 CHECK((state=`)
  .replace('FOREIGN KEY(run_id,session_id)', 'FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,\n FOREIGN KEY(run_id,session_id)')
  .replace('CREATE INDEX chat_sessions_updated ON chat_sessions(updated_at DESC,id);', '')
  .replaceAll('chat_one_running', 'agent_one_running'))
const admission = agentNames(askRuntimeMigration.slice(0, askRuntimeMigration.indexOf('CREATE TABLE chat_context_checkpoints')))
  .replaceAll('chat_one_running', 'agent_one_running')
const progress = agentNames(askRuntimeMigration.slice(askRuntimeMigration.indexOf('CREATE TABLE chat_memory_progress')))

/** Keep the original sequence within a chat and allocate a per-run sequence for isolated items. */
export const agentStorageMigration = `
DROP TRIGGER chat_react_cycles_insert;
DROP TRIGGER chat_react_cycles_update;
DROP TRIGGER chat_react_cycles_delete;
${tables.map(([old]) => `ALTER TABLE ${old} RENAME TO old_${old};`).join('\n')}
ALTER TABLE chat_memory_progress RENAME TO old_chat_memory_progress;
${storage}
${admission}
${agentNames(chatModelRequestsMigration + chatProtocolMigration + chatReactCyclesMigration)}
${progress}
INSERT INTO agent_runs(id,session_id,provider_id,model_id,state,error,event_sequence,write_started,request_id,request_hash,
 owner_runtime_id,created_at,finished_at,admission,runtime_status,agent,source)
SELECT id,session_id,provider_id,model_id,state,error,event_sequence,write_started,request_id,request_hash,
 owner_runtime_id,created_at,finished_at,admission,runtime_status,'ask',
 CASE WHEN EXISTS (SELECT 1 FROM old_chat_items i WHERE i.run_id=r.id
   AND json_extract(i.content_json,'$.type')='user_message' AND json_extract(i.content_json,'$.source')='smart-paste')
 THEN 'smart-paste' ELSE 'chat' END FROM old_chat_runs r;
${tables.slice(1).map(([old, next]) => `INSERT INTO ${next} SELECT * FROM old_${old};`).join('\n')}
INSERT INTO chat_memory_progress SELECT * FROM old_chat_memory_progress;
DROP TABLE old_chat_memory_progress;
${[...tables].reverse().map(([old]) => `DROP TABLE old_${old};`).join('\n')}
CREATE UNIQUE INDEX agent_isolated_item_sequence ON agent_items(run_id,sequence) WHERE session_id IS NULL;
CREATE TRIGGER agent_item_session BEFORE INSERT ON agent_items
WHEN NEW.session_id IS NOT (SELECT session_id FROM agent_runs WHERE id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'invalid item session'); END;
${agentNames(chatReactCycleConstraintsMigration)}
`
