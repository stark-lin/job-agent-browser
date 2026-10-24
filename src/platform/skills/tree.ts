import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ExternalSkillsError } from '../../shared/external-skills'

export class ExternalSkillsFailure extends Error {
  constructor(readonly code: ExternalSkillsError) { super(code) }
}
export function skillsError(error: unknown): ExternalSkillsError {
  return error instanceof ExternalSkillsFailure ? error.code : 'INSTALL_FAILED'
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

// Snapshot content and filesystem identity separately: identical files need no rewrite,
// while replacement or chmod during a confirmation invalidates the revision.
export function skillTree(path: string, source = false) {
  const content: unknown[] = [], identity: unknown[] = []
  let bytes = 0, entries = 0
  function visit(file: string, relative: string, depth: number) {
    if (++entries > 512 || depth > 16) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
    const stat = lstatSync(file)
    identity.push([relative, stat.dev, stat.ino, stat.mode, stat.mtimeMs, stat.ctimeMs])
    if (stat.isSymbolicLink()) {
      if (source) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
      content.push([relative, 'link', readlinkSync(file)])
    } else if (stat.isDirectory()) {
      content.push([relative, 'directory'])
      for (const name of readdirSync(file).sort()) visit(join(file, name), relative ? `${relative}/${name}` : name, depth + 1)
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > 8 * 1024 * 1024) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
      content.push([relative, 'file', readFileSync(file).toString('base64')])
    } else {
      if (source) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
      content.push([relative, 'special'])
    }
  }
  let root
  try { root = lstatSync(path) }
  catch (error) {
    if (!source && missing(error)) return { content: 'missing', revision: digest('missing'), missing: true }
    throw error
  }
  if (source && !root.isDirectory()) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
  if (root.isSymbolicLink() && !source) {
    identity.push(['link', root.dev, root.ino, root.mode, root.mtimeMs, root.ctimeMs, readlinkSync(path)])
    try {
      const resolved = realpathSync(path)
      identity.push(['resolved', resolved])
      visit(resolved, '', 0)
    } catch (error) {
      if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ELOOP') throw error
      content.push(['', 'broken-link'])
    }
  } else visit(path, '', 0)
  if (source && !statSync(join(path, 'SKILL.md')).isFile()) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
  return { content: digest(content), revision: digest([content, identity]), missing: false }
}

// Includes the nearest existing ancestor so a redirected parent symlink also
// invalidates a pending confirmation. Directory timestamps are intentionally absent.
export function directoryIdentity(path: string): string {
  try {
    const real = realpathSync(path), stat = statSync(real)
    if (!stat.isDirectory()) throw new ExternalSkillsFailure('SKILLS_UNAVAILABLE')
    return digest([real, stat.dev, stat.ino, stat.mode])
  } catch (error) {
    if (!missing(error) || dirname(path) === path) throw error
    return digest([path, directoryIdentity(dirname(path))])
  }
}
