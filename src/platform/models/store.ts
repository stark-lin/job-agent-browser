import { mkdir, lstat, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { safeParents } from './core.cjs'
export class ModelStore {
  readonly directory: string
  readonly staging: string
  constructor(readonly root: string, readonly id: string, readonly revision: string) {
    this.directory = join(root, id, revision)
    this.staging = join(root, '.staging', `${id}-${revision}`)
  }
  async lock(compromised: () => void, retries = 0) {
    await safeParents(this.root, `.locks/${this.id}.lock/placeholder`)
    await mkdir(join(this.root, '.locks'), { recursive: true })
    return lockfile.lock(join(this.root, '.locks', this.id), { realpath: false, stale: 30000, retries: { retries, minTimeout: 20, maxTimeout: 100 },
      onCompromised: compromised })
  }
  private get leases() { return join(this.root, '.leases', `${this.id}-${this.revision}`) }
  async acquireLease(compromised: () => void) {
    const unlock = await this.lock(compromised, 20)
    try {
      await this.checkPaths()
      await safeParents(this.root, `.leases/${this.id}-${this.revision}/placeholder`)
      await mkdir(this.leases, { recursive: true })
      return await lockfile.lock(join(this.leases, randomUUID()), { realpath: false, stale: 30000, onCompromised: compromised })
    } finally { await unlock() }
  }
  async assertNoReaders() {
    await safeParents(this.root, `.leases/${this.id}-${this.revision}/placeholder`)
    const entries = await readdir(this.leases).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const name of entries) {
      if (!/^[a-f0-9-]+\.lock$/.test(name)) throw new Error('MODEL_UNSAFE_LEASE')
      const path = join(this.leases, name)
      if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new Error('MODEL_UNSAFE_LEASE')
      if (await lockfile.check(path.slice(0, -5), { realpath: false, stale: 30000 })) throw new Error('MODEL_BUSY')
      await rm(path, { recursive: true, force: true })
    }
  }
  async checkPaths() {
    await safeParents(this.root, `${this.id}/${this.revision}/placeholder`)
    await safeParents(this.root, `.staging/${this.id}-${this.revision}/placeholder`)
  }
  async commit(record: object) {
    await this.checkPaths()
    await writeFile(join(this.staging, '.installed.json'), JSON.stringify(record), { flag: 'wx' })
    await mkdir(join(this.root, this.id), { recursive: true })
    const previous = this.directory + '.' + randomUUID() + '.old'
    const exists = await lstat(this.directory).catch(e => { if (e.code !== 'ENOENT') throw e })
    if (exists) await rename(this.directory, previous)
    try { await rename(this.staging, this.directory) }
    catch (error) { if (exists) await rename(previous, this.directory); throw error }
    if (exists) await rm(previous, { recursive: true, force: true })
  }
}
