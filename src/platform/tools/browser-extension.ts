import type { JsonValue } from '../../shared/tools/tool.types'
import { ToolError } from '../../shared/tools/errors'
import { extensionSummary } from '../storage/browser-extensions'
import type { BrowserExtensionInstaller } from '../browser/extension-installer'
import type { AuditedCapabilities } from './capabilities'

export function createBrowserExtensionTools(capabilities: AuditedCapabilities, installer?: BrowserExtensionInstaller) {
  const service = () => {
    if (!installer) throw new ToolError('TOOL_UNAVAILABLE')
    return installer
  }
  return [
    capabilities.read({
      name: 'browser.extension.list', description: 'List installed JAB browser extensions, their requested enablement and pending removal.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: { type: 'native' }, tags: ['browser', 'extensions'], mode: 'read', risk: 'READ'
    }, () => ({ content: [], structuredContent: { extensions: service().store.read().extensions.map(extensionSummary) } })),
    capabilities.write({
      name: 'browser.extension.install',
      description: 'Import a local unpacked Manifest V3 directory on the MCP server host. Supply an absolute path and reuse the UUID v4 requestId only for identical retries. Successful new imports are disabled. Tell the user to enable them in Settings.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4096 },
        requestId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' } },
        required: ['path', 'requestId'], additionalProperties: false },
      source: { type: 'native' }, tags: ['browser', 'extensions'], mode: 'write', risk: 'WRITE'
    }, async (input, { signal }) => {
      const { path, requestId } = input as { path: string; requestId: string }
      const result = await service().installFromMCP(path, requestId, signal)
      return { content: [], structuredContent: result as JsonValue }
    }, { timeoutMs: 120000 })
  ]
}
