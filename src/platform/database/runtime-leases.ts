import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { fail } from '../../domain/common/errors'

type Kind = 'generation' | 'output'
const lifetime = 30000
/** A process lease never resurrects after expiry. Work tokens fence late async workers. */
export function createRuntimeLease(db: DatabaseSync, kind: 'internal' | 'external') {
  const id = randomUUID()
  db.prepare('INSERT INTO runtime_instances VALUES(?,?,?,?)').run(id, process.pid, kind, Date.now() + lifetime)
  let closed = false
  function live(runtimeId: string): boolean {
    const row = db.prepare('SELECT pid,expires_at FROM runtime_instances WHERE id=?').get(runtimeId)
    if (!row || Number(row.expires_at) <= Date.now()) return false
    try { process.kill(Number(row.pid), 0); return true } catch (error) {
      return !!error && typeof error === 'object' && 'code' in error && error.code === 'EPERM'
    }
  }
  function current() { if (closed || !live(id)) fail('CONFLICT') }
  const owner = (work: Kind, target: string) => db.prepare('SELECT runtime_id,token FROM runtime_work WHERE kind=? AND target_id=?').get(work, target)
  const timer = setInterval(() => {
    try { db.prepare('UPDATE runtime_instances SET expires_at=? WHERE id=? AND expires_at>?').run(Date.now() + lifetime, id, Date.now()) }
    catch { /* A busy database may delay renewal; expired instances must restart. */ }
  }, 5000)
  timer.unref()
  return {
    id, kind, live, ensure: current,
    assert(work: Kind, target: string) {
      current()
      const row = owner(work, target)
      if (!row || row.runtime_id !== id) fail('FORBIDDEN')
    },
    available(work: Kind, target: string) {
      current()
      const row = owner(work, target)
      if (row && live(String(row.runtime_id))) fail('CONFLICT')
    },
    claim(work: Kind, target: string) {
      current()
      const row = owner(work, target)
      if (row && live(String(row.runtime_id))) fail('CONFLICT')
      const token = randomUUID()
      db.prepare('INSERT INTO runtime_work VALUES(?,?,?,?) ON CONFLICT(kind,target_id) DO UPDATE SET runtime_id=excluded.runtime_id,token=excluded.token')
        .run(work, target, id, token)
      return token
    },
    valid(work: Kind, target: string, token: string) {
      current()
      const row = owner(work, target)
      if (!row || row.runtime_id !== id || row.token !== token) fail('CONFLICT')
    },
    release(work: Kind, target: string, token: string) {
      db.prepare('DELETE FROM runtime_work WHERE kind=? AND target_id=? AND runtime_id=? AND token=?').run(work, target, id, token)
    },
    active(work: Kind, target: string) { const row = owner(work, target); return !!row && live(String(row.runtime_id)) },
    foreign(work: Kind, target: string) { const row = owner(work, target); return !!row && row.runtime_id !== id && live(String(row.runtime_id)) },
    close() {
      if (closed) return
      closed = true; clearInterval(timer)
      db.prepare('UPDATE runtime_instances SET expires_at=0 WHERE id=?').run(id)
    }
  }
}
export type RuntimeLease = ReturnType<typeof createRuntimeLease>
