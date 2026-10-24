import { cpSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { externalMCPTargets, type ExternalMCPTarget } from '../../shared/external-mcp'
import { externalSkillNames, type ExternalSkillsOutcome, type ExternalSkillsStatus } from '../../shared/external-skills'
import { digest, directoryIdentity, ExternalSkillsFailure, skillsError, skillTree } from './tree'

function input(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) ||
    keys.some(key => !Object.hasOwn(value, key))) throw new ExternalSkillsFailure('INVALID_INPUT')
  return value as Record<string, unknown>
}
export function externalSkillsPath(home: string, target: ExternalMCPTarget) {
  return join(home, target === 'codex' ? '.agents' : target === 'claude-code' ? '.claude' : '.cursor', 'skills')
}
export function createExternalSkillsInstaller(options: {
  home: string; bundleDirectory: string; openPath(path: string): Promise<string>
}) {
  const bundle = () => {
    try { return externalSkillNames.map(name => skillTree(join(options.bundleDirectory, name), true)) }
    catch { throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE') }
  }
  function snapshot(target: ExternalMCPTarget, desired: ReturnType<typeof bundle>) {
    const path = externalSkillsPath(options.home, target), parent = directoryIdentity(path)
    const trees = externalSkillNames.map(name => skillTree(join(path, name)))
    const status: ExternalSkillsStatus = { target, path,
      revision: digest([parent, trees.map(tree => tree.revision), desired.map(tree => tree.revision)]),
      skills: externalSkillNames.map((name, index) => ({ name, state: trees[index].missing ? 'missing' :
        trees[index].content === desired[index].content ? 'installed' : 'different' })) }
    return { status, trees }
  }
  function inspectTarget(target: ExternalMCPTarget): ExternalSkillsStatus {
    try { return snapshot(target, bundle()).status }
    catch { return { target, path: externalSkillsPath(options.home, target), revision: '', error: 'SKILLS_UNAVAILABLE',
      skills: externalSkillNames.map(name => ({ name, state: 'unavailable' })) } }
  }
  return {
    inspect(value: unknown) {
      input(value, [])
      return { clients: externalMCPTargets.map(inspectTarget) }
    },
    install(value: unknown): ExternalSkillsOutcome {
      const request = input(value, ['target', 'revision', 'replace'])
      if (!externalMCPTargets.includes(request.target as ExternalMCPTarget) || typeof request.revision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.revision) || typeof request.replace !== 'boolean') throw new ExternalSkillsFailure('INVALID_INPUT')
      const target = request.target as ExternalMCPTarget
      const completed: ExternalSkillsOutcome['completed'] = []
      let staging: string | undefined
      let error: ExternalSkillsOutcome['error']
      try {
        const desired = bundle(), before = snapshot(target, desired), { path } = before.status
        if (before.status.revision !== request.revision) throw new ExternalSkillsFailure('SKILLS_CHANGED')
        if (!request.replace && before.status.skills.some(skill => skill.state === 'different')) throw new ExternalSkillsFailure('REPLACE_REQUIRED')
        const changed = before.status.skills.filter(skill => skill.state !== 'installed')
        if (changed.length) {
          mkdirSync(path, { recursive: true })
          const parent = directoryIdentity(path)
          const destination = realpathSync(path)
          staging = mkdtempSync(join(destination, '.job-agent-skills-'))
          for (const { name } of changed) {
            cpSync(join(options.bundleDirectory, name), join(staging, name), { recursive: true, dereference: false })
            if (skillTree(join(staging, name), true).content !== desired[externalSkillNames.indexOf(name)].content) throw new ExternalSkillsFailure('SKILLS_CHANGED')
          }
          for (const { name } of changed) {
            if (directoryIdentity(path) !== parent ||
              externalSkillNames.some((other, index) => !completed.includes(other) && skillTree(join(path, other)).revision !== before.trees[index].revision) ||
              digest(bundle().map(tree => tree.revision)) !== digest(desired.map(tree => tree.revision))) throw new ExternalSkillsFailure('SKILLS_CHANGED')
            // rm does not follow a root symlink: the referenced directory stays intact.
            rmSync(join(destination, name), { recursive: true, force: true })
            renameSync(join(staging, name), join(destination, name))
            completed.push(name)
          }
        }
      } catch (caught) { error = skillsError(caught) }
      finally {
        if (staging) {
          try { rmSync(staging, { recursive: true, force: true }) }
          catch { error ??= 'INSTALL_FAILED' }
        }
      }
      const status = inspectTarget(target)
      if (status.error) error ??= status.error
      const pending = status.skills.filter(skill => skill.state !== 'installed').map(skill => skill.name)
      if (pending.length) error ??= 'SKILLS_CHANGED'
      return { status, completed, pending, ...(error ? { error } : {}) }
    },
    async openBundle(value: unknown) {
      input(value, [])
      try { bundle() } catch { throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE') }
      try { if (await options.openPath(options.bundleDirectory)) throw new Error() }
      catch { throw new ExternalSkillsFailure('OPEN_FAILED') }
      return null
    }
  }
}
export type ExternalSkillsInstaller = ReturnType<typeof createExternalSkillsInstaller>
