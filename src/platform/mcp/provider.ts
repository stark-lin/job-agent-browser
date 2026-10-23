import { toolError, toolFail, type ToolErrorCode } from '../../shared/tools/errors'
import type { RegisteredTool } from '../../shared/tools/tool.types'
import type { AuditedCapabilities } from '../tools/capabilities'
import type { MCPClient } from './client'
import { mcpDescriptor, type MCPServerConfig } from './server-config'
import { adaptMCPResult, schemaFingerprint } from './tool-adapter'

export function createMCPProvider(config: MCPServerConfig, client: MCPClient, capabilities: AuditedCapabilities) {
  return {
    async discover(signal?: AbortSignal): Promise<{ tools: RegisteredTool[]; rejected: { name: string; error: ToolErrorCode }[] }> {
      const discovered = await client.listTools(signal), names = new Set<string>()
      for (const tool of discovered) {
        if (names.has(tool.name)) toolFail('MCP_INVALID_RESPONSE')
        names.add(tool.name)
      }
      const tools: RegisteredTool[] = [], rejected: { name: string; error: ToolErrorCode }[] = []
      for (const reviewed of config.tools) {
        const upstream = discovered.find(tool => tool.name === reviewed.originalName)
        try {
          if (!upstream) toolFail('TOOL_UNAVAILABLE')
          if (schemaFingerprint(upstream.inputSchema) !== schemaFingerprint(reviewed.inputSchema) ||
            (upstream.outputSchema === undefined) !== (reviewed.outputSchema === undefined) ||
            (upstream.outputSchema && schemaFingerprint(upstream.outputSchema) !== schemaFingerprint(reviewed.outputSchema))) toolFail('MCP_INVALID_RESPONSE')
          const descriptor = mcpDescriptor(config.id, reviewed)
          tools.push(capabilities.read(descriptor, async (input, context) => adaptMCPResult(await client.callTool(reviewed.originalName, input, context.signal))))
        } catch (error) { rejected.push({ name: reviewed.name, error: toolError(error).code }) }
      }
      return { tools, rejected }
    }
  }
}
