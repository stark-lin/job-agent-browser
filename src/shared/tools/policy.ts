import { toolFail } from './errors'
import type { ToolDescriptor, ToolRisk, ToolScopePolicy } from './tool.types'

export const risks: readonly ToolRisk[] = ['READ', 'COMPUTE', 'WRITE', 'EXTERNAL_ACTION']
const segment = '[a-z][a-z0-9_-]*'
const namePattern = new RegExp(`^${segment}(\\.${segment})+$`)
const namespacePattern = new RegExp(`^${segment}(\\.${segment})*\\.\\*$`)
const reserved = new Set(['generation', 'audit', 'database', 'transaction', 'secret', 'secrets'])
export const nativeNamespaces = new Set(['job', 'profile', 'artifact', 'browser', 'resume'])

export function validToolName(name: string): boolean {
  return typeof name === 'string' && name.length <= 128 && namePattern.test(name) &&
    !name.split('.').some(part => ['constructor', 'prototype', '__proto__'].includes(part))
}
export function validateDescriptor(tool: ToolDescriptor): void {
  if (!validToolName(tool.name) || reserved.has(tool.name.split('.')[0]) || !risks.includes(tool.risk) ||
    tool.mode !== (risks.indexOf(tool.risk) < 2 ? 'read' : 'write') ||
    typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > 4096 ||
    !Array.isArray(tool.tags) || tool.tags.length > 16 || tool.tags.some(tag => !/^[a-z][a-z0-9_-]{0,63}$/.test(tag))) toolFail('TOOL_INVALID_CONFIG')
  if (tool.source.type === 'mcp' && (nativeNamespaces.has(tool.name.split('.')[0]) ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(tool.source.serverId) || !tool.name.startsWith(`${tool.source.serverId}.`) ||
    typeof tool.source.originalName !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.source.originalName))) toolFail('TOOL_INVALID_CONFIG')
  if (!['native', 'mcp'].includes(tool.source.type)) toolFail('TOOL_INVALID_CONFIG')
}
export function validatePolicy(policy: ToolScopePolicy): ToolScopePolicy {
  if (!policy || !Array.isArray(policy.allow) || (policy.deny !== undefined && !Array.isArray(policy.deny)) ||
    !risks.includes(policy.maxRisk ?? 'READ')) toolFail('TOOL_INVALID_CONFIG')
  for (const pattern of [...policy.allow, ...(policy.deny ?? [])]) {
    if (typeof pattern !== 'string' || pattern.length > 128 || (!validToolName(pattern) && !namespacePattern.test(pattern))) toolFail('TOOL_INVALID_CONFIG')
  }
  return { allow: [...policy.allow], deny: [...(policy.deny ?? [])], maxRisk: policy.maxRisk ?? 'READ' }
}
const matches = (name: string, pattern: string) => pattern.endsWith('.*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern
export function permitted(tool: ToolDescriptor, policy: ToolScopePolicy): boolean {
  return policy.allow.some(pattern => matches(tool.name, pattern)) &&
    !policy.deny?.some(pattern => matches(tool.name, pattern)) && risks.indexOf(tool.risk) <= risks.indexOf(policy.maxRisk ?? 'READ')
}
