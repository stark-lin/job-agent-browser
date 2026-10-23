import { readFileSync, statSync, existsSync } from 'node:fs'
import { parseMCPConfiguration, type MCPConfiguration } from '../mcp/server-config'
import { toolFail } from '../../shared/tools/errors'

/** Main-only, manually reviewed configuration. Missing configuration launches no child processes. */
export function readMCPConfiguration(path: string): MCPConfiguration {
  try {
    if (!existsSync(path)) return { version: 1, servers: [] }
    if (statSync(path).size > 1048576) toolFail('TOOL_INVALID_CONFIG')
    return parseMCPConfiguration(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch { return toolFail('TOOL_INVALID_CONFIG') }
}
