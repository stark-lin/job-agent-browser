import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createServerRuntime } from './runtime'

async function main() {
  const directory = process.env.JOB_BROWSER_USER_DATA
  if (!directory) throw new Error('MCP_DATA_REQUIRED')
  const runtime = createServerRuntime(directory, __dirname)
  let closing: Promise<void> | undefined
  const close = () => closing ??= runtime.dispose().finally(() => { process.exitCode = 0 })
  runtime.server.onclose = () => { void close() }
  process.once('SIGTERM', () => { void close() })
  process.once('SIGINT', () => { void close() })
  try { await runtime.server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2097152 })) }
  catch { await close(); throw new Error('MCP_START_FAILED') }
}
void main().catch(error => {
  const code = error instanceof Error && ['MCP_DATA_REQUIRED', 'MCP_NODE_UNSUPPORTED', 'MCP_START_FAILED'].includes(error.message) ? error.message : 'MCP_START_FAILED'
  process.stderr.write(`${code}\n`); process.exitCode = 1
})
