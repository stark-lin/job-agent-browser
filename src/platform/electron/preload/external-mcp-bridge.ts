import type { ExternalMCPAPI, ExternalMCPError } from '../../../shared/external-mcp'
import type { Result } from '../../../shared/ipc'

export function createExternalMCPBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown, ExternalMCPError>>): ExternalMCPAPI {
  return {
    inspect: input => invoke('inspect', input) as ReturnType<ExternalMCPAPI['inspect']>,
    install: input => invoke('install', input) as ReturnType<ExternalMCPAPI['install']>,
    reconnect: input => invoke('reconnect', input) as ReturnType<ExternalMCPAPI['reconnect']>,
    remove: input => invoke('remove', input) as ReturnType<ExternalMCPAPI['remove']>,
    test: input => invoke('test', input) as ReturnType<ExternalMCPAPI['test']>,
    copy: input => invoke('copy', input) as ReturnType<ExternalMCPAPI['copy']>
  }
}
