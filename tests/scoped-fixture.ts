import type { AgentTools } from '../src/shared/agent'
import { scopeTools, scopeDirectory } from '../src/platform/mcp-server/scope-tools'
import { humanTool } from '../src/platform/mcp-server/tool-adapter'
export function scopedFixture(tools: AgentTools): AgentTools {
  return { ...tools, async list() { const catalog = await tools.list(); return [...catalog, ...scopeTools(catalog), humanTool] },
    async call(name, args, signal) { return name.startsWith('scope.') ? scopeDirectory(name, await tools.list()) : tools.call(name, args, signal) } }
}
