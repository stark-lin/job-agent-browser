import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

// Real SDK server, deliberately including unknown and failing capabilities for host tests.
if (process.argv.includes('--silent')) {
  process.stdin.resume()
} else {
  const server = new Server({ name: 'test-capabilities', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  const inputSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
  let changed = false, cancellations = 0
  const names = ['echo', 'slow', 'fail', 'image', 'bad_output', 'change', 'restore', 'crash', 'environment', 'large', 'delete_everything']
  server.setRequestHandler('tools/list', async request => {
    if (process.argv.includes('--slow-list')) await new Promise(resolve => setTimeout(resolve, 200))
    const cursor = Number(request.params?.cursor ?? '0')
    const available = names.filter(name => !changed || name !== 'slow').concat(changed ? ['new_danger'] : [])
    const tools = available.slice(cursor, cursor + 2).map(name => ({ name, description: 'UNTRUSTED_UPSTREAM_DESCRIPTION',
      inputSchema: changed && name === 'echo' ? { ...inputSchema, properties: { text: { type: 'string', maxLength: 8 } } } : inputSchema }))
    return { tools, ...(process.argv.includes('--endless') || cursor + 2 < available.length ? { nextCursor: String(cursor + 2) } : {}) }
  })
  server.setRequestHandler('tools/call', async (request, context) => {
    const name = request.params.name, text = request.params.arguments?.text ?? ''
    if (name === 'crash') { setTimeout(() => process.exit(2), 5); await new Promise(() => {}) }
    if (name === 'change' || name === 'restore') {
      changed = name === 'change'
      setTimeout(() => { void server.sendToolListChanged() }, 20)
    }
    if (name === 'slow') {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000)
        context.mcpReq.signal.addEventListener('abort', () => { cancellations++; clearTimeout(timer); resolve() }, { once: true })
      })
    }
    if (name === 'fail') return { content: [{ type: 'text', text: 'PRIVATE_SERVER_ERROR_TOKEN' }], isError: true }
    if (name === 'image') return { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }
    if (name === 'large') return { content: [{ type: 'text', text: 'x'.repeat(1048577) }] }
    if (name === 'bad_output') return { content: [], structuredContent: { unexpected: true } }
    if (name === 'environment') return { content: [], structuredContent: { secretInherited: !!process.env.MCP_TEST_PRIVATE_TOKEN,
      electronNode: process.env.ELECTRON_RUN_AS_NODE === '1' } }
    return { content: [{ type: 'text', text }], structuredContent: { text, pid: process.pid, cancellations } }
  })
  server.onclose = () => process.exit(0)
  await server.connect(new StdioServerTransport())
}
