import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { redeemMemoryLaunch } from '../mcp/memory-authority'
import { createServerRuntime } from './runtime'

async function main() {
  const directory = process.env.JOB_BROWSER_USER_DATA
  if (!directory) throw new Error('MCP_DATA_REQUIRED')
  const authorized = await redeemMemoryLaunch(process.env.JOB_BROWSER_MEMORY_LAUNCH, directory)
  delete process.env.JOB_BROWSER_MEMORY_LAUNCH
  const runtime = createServerRuntime(directory, __dirname, undefined, process.env.JOB_BROWSER_MCP_CALLER, authorized, process.env.JOB_BROWSER_ASK_READ_ONLY === '1')
  let closing: Promise<void> | undefined
  const close = () => closing ??= runtime.dispose().finally(() => { process.exitCode = 0 })
  authorized?.signal.addEventListener('abort', () => { void close() }, { once: true })
  runtime.server.onclose = () => { void close() }
  process.once('SIGTERM', () => { void close() })
  process.once('SIGINT', () => { void close() })
  try { await runtime.ready; await runtime.server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2097152 })) }
  catch { await close(); throw new Error('KNOWLEDGE_RECOVERY_REQUIRED_START_JAB') }
}
void main().catch(error => {
  const code = error instanceof Error && ['MCP_DATA_REQUIRED', 'MCP_NODE_UNSUPPORTED', 'MCP_START_FAILED', 'MEMORY_AUTH_FAILED', 'KNOWLEDGE_RECOVERY_REQUIRED_START_JAB'].includes(error.message) ? error.message : 'MCP_START_FAILED'
  process.stderr.write(`${code}\n`); process.exitCode = 1
})
