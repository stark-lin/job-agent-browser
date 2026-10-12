import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function readJSON(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : undefined
}

/** Replace only after the complete file is written. Never truncate the last good file. */
export function writeJSON(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
