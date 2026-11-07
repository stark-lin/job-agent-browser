import { AgentError, type AgentToolDescriptor, type AgentTools } from '../../../shared/agent'

export interface AgentToolset {
  refresh(): Promise<void>
  loadout(): AgentToolDescriptor[]
  snapshot(): { version: number; tools: AgentToolDescriptor[] }
  confirmRequest(names: readonly string[]): void
  call(name: string, args: unknown, signal: AbortSignal): Promise<unknown>
}

export function createFixedToolset(tools: AgentTools, allow: readonly string[]): AgentToolset {
  let catalog: AgentToolDescriptor[] | undefined
  const loadout = () => structuredClone(catalog ?? [])
  return {
    async refresh() {
      if (catalog) return
      const listed = await tools.list()
      catalog = allow.map(name => {
        const tool = listed.find(item => item.name === name)
        if (!tool) throw new AgentError('AGENT_PROTOCOL_ERROR')
        return tool
      })
    },
    loadout,
    snapshot: () => ({ version: 1, tools: loadout() }),
    confirmRequest() {},
    call(name, args, signal) {
      if (!catalog?.some(tool => tool.name === name)) throw new AgentError('AGENT_PROTOCOL_ERROR')
      return tools.call(name, args, signal)
    }
  }
}
