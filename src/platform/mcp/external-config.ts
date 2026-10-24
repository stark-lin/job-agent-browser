import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseTOML, stringifyTOML } from '../storage/toml'
import { applyEdits, modify, parse as parseJSONC, type ParseError } from 'jsonc-parser'
import { externalMCPErrors, externalMCPTargets, type ExternalMCPError, type ExternalMCPStatus, type ExternalMCPTarget } from '../../shared/external-mcp'

export class ExternalMCPFailure extends Error {
  constructor(readonly code: ExternalMCPError) { super(code) }
}
export function externalMCPError(error: unknown): ExternalMCPError {
  return error instanceof ExternalMCPFailure && externalMCPErrors.includes(error.code) ? error.code : 'CONFIG_UNAVAILABLE'
}
export function mcpTarget(input: unknown): ExternalMCPTarget {
  if (!externalMCPTargets.includes(input as ExternalMCPTarget)) throw new ExternalMCPFailure('INVALID_INPUT')
  return input as ExternalMCPTarget
}
export function mcpInput(input: unknown, keys: string[]): Record<string, unknown> {
  if (!record(input) || Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) {
    throw new ExternalMCPFailure('INVALID_INPUT')
  }
  return input
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
const serverName = 'job_agent_browser'
export interface MCPLaunch { command: string; args: string[]; env: Record<string, string> }
export interface ExternalMCPPaths { home: string; codexHome?: string }
export function externalMCPPath(target: ExternalMCPTarget, paths: ExternalMCPPaths): string {
  if (target === 'codex') return join(paths.codexHome ? resolve(paths.codexHome) : join(paths.home, '.codex'), 'config.toml')
  return target === 'cursor' ? join(paths.home, '.cursor', 'mcp.json') : join(paths.home, '.claude.json')
}
export function externalMCPEntry(target: ExternalMCPTarget | 'other', launch: MCPLaunch) {
  return { ...(target === 'codex' ? { tool_timeout_sec: 100 } : { type: 'stdio' }),
    command: launch.command, args: [...launch.args], env: { ...launch.env, JOB_BROWSER_MCP_CALLER: target === 'other' ? 'mcp-client' : target } }
}
export function externalMCPText(target: ExternalMCPTarget | 'other', launch: MCPLaunch): string {
  const entry = externalMCPEntry(target, launch)
  return target === 'codex' ? stringifyTOML({ mcp_servers: { [serverName]: entry } }) : JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2)
}
function snapshot(path: string) {
  let actual = path, body: string | undefined, identity = 'missing'
  try {
    lstatSync(path) // A dangling symlink is an error, not an absent configuration.
    actual = realpathSync(path)
    const stat = statSync(actual)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new ExternalMCPFailure('CONFIG_UNAVAILABLE')
    body = readFileSync(actual, 'utf8')
    identity = `${actual}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    // lstat succeeds for a dangling link; refuse to replace it.
    try { lstatSync(path); throw new ExternalMCPFailure('CONFIG_UNAVAILABLE') }
    catch (missing) { if (missing instanceof ExternalMCPFailure) throw missing }
  }
  return { actual, body, revision: createHash('sha256').update(identity).update(body ?? '').digest('hex') }
}
function document(target: ExternalMCPTarget, body: string | undefined) {
  try {
    const errors: ParseError[] = []
    const value: unknown = body === undefined ? {} : target === 'codex'
      ? parseTOML(body, { integersAsBigInt: true })
      : parseJSONC(body, errors, { allowTrailingComma: target === 'cursor', disallowComments: target !== 'cursor' })
    if (errors.length || !record(value)) throw new Error()
    const key = target === 'codex' ? 'mcp_servers' : 'mcpServers'
    const servers = Object.hasOwn(value, key) ? value[key] : {}
    if (!record(servers)) throw new Error()
    return { value, servers, key }
  } catch { throw new ExternalMCPFailure('CONFIG_INVALID') }
}
function matches(target: ExternalMCPTarget, entry: unknown, launch: MCPLaunch) {
  if (!record(entry)) return false
  const expected = externalMCPEntry(target, launch)
  // Policy fields are user-owned. A disabled server needs an explicit replacement.
  return entry.enabled !== false && entry.url === undefined && entry.command === expected.command &&
    isDeepStrictEqual(entry.args, expected.args) && record(entry.env) &&
    Object.keys(entry.env).length === Object.keys(expected.env).length &&
    Object.entries(expected.env).every(([name, value]) => (entry.env as Record<string, unknown>)[name] === value) &&
    (target !== 'codex' || entry.tool_timeout_sec === 100n) && (entry.type === undefined || entry.type === 'stdio')
}
export function createExternalMCPConfig(paths: ExternalMCPPaths, launch: MCPLaunch) {
  const pathFor = (target: ExternalMCPTarget) => externalMCPPath(target, paths)
  function inspect(target: ExternalMCPTarget): ExternalMCPStatus {
    const base = { target, path: pathFor(target), revision: '', config: externalMCPText(target, launch) }
    try {
      const saved = snapshot(base.path)
      base.revision = saved.revision
      const { servers } = document(target, saved.body), entry = Object.hasOwn(servers, serverName) ? servers[serverName] : undefined
      return { ...base, state: entry === undefined ? 'missing' : matches(target, entry, launch) ? 'configured' : 'different' }
    } catch (error) {
      const code = externalMCPError(error)
      return { ...base, state: code === 'CONFIG_INVALID' ? 'invalid' : 'unavailable', error: code }
    }
  }
  return {
    inspect,
    install(target: ExternalMCPTarget, revision: string, replace: boolean) {
      const path = pathFor(target), saved = snapshot(path)
      if (saved.revision !== revision) throw new ExternalMCPFailure('CONFIG_CHANGED')
      const parsed = document(target, saved.body), entry = Object.hasOwn(parsed.servers, serverName) ? parsed.servers[serverName] : undefined
      if (matches(target, entry, launch)) return { status: inspect(target) }
      if (entry !== undefined && !replace) throw new ExternalMCPFailure('REPLACE_REQUIRED')
      const next = externalMCPEntry(target, launch)
      let body: string
      if (target === 'codex') {
        parsed.servers[serverName] = { ...next, tool_timeout_sec: 100n }
        parsed.value[parsed.key] = parsed.servers
        body = stringifyTOML(parsed.value, { numbersAsFloat: true })
      } else {
        body = applyEdits(saved.body ?? '{}', modify(saved.body ?? '{}', [parsed.key, serverName], next,
          { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }))
      }
      document(target, body)
      mkdirSync(dirname(saved.actual), { recursive: true })
      const temporary = `${saved.actual}.${randomUUID()}.tmp`
      let backupPath: string | undefined
      try {
        writeFileSync(temporary, body, { mode: 0o600, flag: 'wx' })
        if (snapshot(path).revision !== saved.revision) throw new ExternalMCPFailure('CONFIG_CHANGED')
        if (saved.body !== undefined) {
          backupPath = `${saved.actual}.${randomUUID()}.bak`
          writeFileSync(backupPath, saved.body, { mode: 0o600, flag: 'wx' })
        }
        if (snapshot(path).revision !== saved.revision) throw new ExternalMCPFailure('CONFIG_CHANGED')
        renameSync(temporary, saved.actual)
      } finally {
        try { unlinkSync(temporary) } catch { /* A successful rename removes the temporary file. */ }
      }
      return { status: inspect(target), ...(backupPath ? { backupPath } : {}) }
    }
  }
}
