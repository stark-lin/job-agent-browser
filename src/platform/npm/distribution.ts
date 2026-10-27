import { isAbsolute } from 'node:path'
import { nativeMCPEnvironment } from '../mcp/native-environment'
import type { MCPLaunch } from '../mcp/external-config'
export function npmMCPLaunch(directory: string): { npmLaunch?: MCPLaunch; ephemeral?: boolean } {
  if (process.env.JAB_DISTRIBUTION !== 'npm') return {}
  const node = process.env.JAB_NODE_EXECUTABLE, cli = process.env.JAB_NPM_CLI
  if (!node || !cli || !isAbsolute(node) || !isAbsolute(cli)) return { ephemeral: true }
  return { ephemeral: process.env.JAB_NPM_EPHEMERAL === '1', npmLaunch: {
    command: node, args: [cli, 'mcp', '--data-dir', directory], env: nativeMCPEnvironment()
  } }
}
