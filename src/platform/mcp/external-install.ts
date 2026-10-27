import { nativeMCPEnvironment } from './native-environment'
import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'
import { externalMCPTargets, type ExternalMCPTarget, type ExternalMCPReconnectResult } from '../../shared/external-mcp'
import { createMCPClient, type MCPClient } from './client'
import { createExternalMCPConfig, externalMCPError, ExternalMCPFailure, externalMCPEntry, externalMCPText, mcpInput, mcpTarget, type MCPLaunch } from './external-config'

export function createExternalMCPInstaller(options: {
  home: string; codexHome?: string; directory: string; bundleDirectory: string; executable: string
  writeClipboard(text: string): void | Promise<void>
  npmLaunch?: MCPLaunch; ephemeral?: boolean
  clientFactory?: (launch: MCPLaunch) => MCPClient
}) {
  const launch: MCPLaunch = options.npmLaunch ?? { command: options.executable, args: [join(options.bundleDirectory, 'job-agent-mcp.js')], env: {
    ...nativeMCPEnvironment(), ELECTRON_RUN_AS_NODE: '1', JOB_BROWSER_USER_DATA: options.directory, JOB_BROWSER_ELECTRON: options.executable
  } }
  const config = createExternalMCPConfig(options, launch)
  const pending = new Map<number, { target: ExternalMCPTarget; controller: AbortController }>()
  const clients = new Set<MCPClient>()
  function runtimeReady() {
    try {
      if (options.ephemeral) throw new Error('EPHEMERAL_NPM_INSTALL')
      accessSync(launch.command, constants.X_OK)
      for (const path of [options.npmLaunch ? launch.args[0] : join(options.bundleDirectory, 'job-agent-mcp.js'), join(options.bundleDirectory, 'resume-output-worker.js'), join(options.directory, 'database.sqlite')]) {
        if (!statSync(path).isFile()) throw new Error()
      }
    } catch { throw new ExternalMCPFailure('RUNTIME_UNAVAILABLE') }
  }
  function change(input: unknown) {
    const value = mcpInput(input, ['target', 'revision']), target = mcpTarget(value.target)
    if (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)) throw new ExternalMCPFailure('INVALID_INPUT')
    return { target, revision: value.revision }
  }
  const service = {
    inspect(input: unknown) {
      mcpInput(input, [])
      return { clients: externalMCPTargets.map(config.inspect), genericConfig: externalMCPText('other', launch) }
    },
    install(input: unknown) {
      const value = mcpInput(input, ['target', 'revision', 'replace']), target = mcpTarget(value.target)
      if (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.replace !== 'boolean') {
        throw new ExternalMCPFailure('INVALID_INPUT')
      }
      runtimeReady()
      return config.install(target, value.revision, value.replace)
    },
    async reconnect(owner: number, input: unknown): Promise<ExternalMCPReconnectResult> {
      const { target, revision } = change(input)
      runtimeReady()
      const result = config.reconnect(target, revision)
      try { return { ...result, ...await service.test(owner, { target }) } }
      catch (error) { return { ...result, error: externalMCPError(error) } }
    },
    remove(input: unknown) {
      const { target, revision } = change(input), result = config.remove(target, revision)
      for (const work of pending.values()) if (work.target === target) work.controller.abort()
      return result
    },
    async copy(input: unknown) {
      const value = mcpInput(input, ['target'])
      const target = value.target === 'other' ? 'other' : mcpTarget(value.target)
      try { await options.writeClipboard(externalMCPText(target, launch)) }
      catch { throw new ExternalMCPFailure('COPY_FAILED') }
      return null
    },
    async test(owner: number, input: unknown) {
      const target: ExternalMCPTarget = mcpTarget(mcpInput(input, ['target']).target)
      if (config.inspect(target).state !== 'configured') throw new ExternalMCPFailure('REPLACE_REQUIRED')
      runtimeReady()
      pending.get(owner)?.controller.abort()
      const controller = new AbortController()
      pending.set(owner, { target, controller })
      const entry = externalMCPEntry(target, launch)
      let client: MCPClient | undefined
      try {
        client = options.clientFactory?.({ command: entry.command, args: entry.args, env: entry.env }) ??
          createMCPClient({ id: 'external-setup-test', enabled: true, transport: 'stdio', command: entry.command, args: entry.args, tools: [] },
            { closed() {}, changed() { controller.abort() } }, { processEnv: entry.env })
        clients.add(client)
        await client.connect(controller.signal)
        const tools = await client.listTools(controller.signal)
        if (controller.signal.aborted || !tools.length) throw new Error()
        return { toolCount: tools.length }
      } catch { throw new ExternalMCPFailure('CONNECTION_FAILED') }
      finally {
        try { await client?.close() }
        finally { if (client) clients.delete(client); if (pending.get(owner)?.controller === controller) pending.delete(owner) }
      }
    },
    disposeOwner(owner: number) { pending.get(owner)?.controller.abort(); pending.delete(owner) },
    async dispose() {
      for (const { controller } of pending.values()) controller.abort()
      pending.clear()
      await Promise.allSettled([...clients].map(client => client.close()))
    }
  }
  return service
}
export type ExternalMCPInstaller = ReturnType<typeof createExternalMCPInstaller>
