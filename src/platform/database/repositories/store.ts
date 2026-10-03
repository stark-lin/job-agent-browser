import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite'
import type { PageResult, TargetType } from '../../../domain/common/ports'
import { DataError } from '../../../domain/common/errors'
import { entityTables } from '../migrations/audit-triggers'
import type { Transactions } from '../transactions'

const jsonColumns = new Set(['locations', 'salary', 'requirements', 'metadata', 'links', 'tags', 'inputSnapshot', 'scores', 'gate', 'selection', 'draft', 'polished', 'config', 'content', 'outputFiles'])
const jsonByTable: Record<string, string[]> = {
  jobs: ['locations', 'salary', 'requirements'], job_events: ['metadata'], profiles: ['links'], profile_items: ['metadata'], facts: ['tags'],
  generation_runs: ['inputSnapshot', 'scores', 'gate', 'selection', 'draft', 'polished', 'config'], artifacts: ['content', 'outputFiles']
}
const snake = (key: string) => key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
const camel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())

/** Low-level mapping stays private to repository adapters; inputs are validated domain values. */
export class Store {
  constructor(readonly db: DatabaseSync, private readonly tx: Transactions) {}
  private column(table: string, key: string) { return snake(key) + (jsonColumns.has(key) && jsonByTable[table]?.includes(key) ? '_json' : '') }
  private encode(table: string, key: string, value: unknown): SQLInputValue {
    if (value === null) return null
    if (jsonByTable[table]?.includes(key)) return JSON.stringify(value)
    if (typeof value === 'string' || typeof value === 'number') return value
    throw new DataError('INVALID_INPUT')
  }
  decode<T>(row: Record<string, SQLOutputValue>): T {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => key.endsWith('_json')
      ? [camel(key.slice(0, -5)), value === null ? null : JSON.parse(String(value))]
      : [camel(key), value])) as T
  }
  get<T>(type: TargetType, id: string): T {
    this.tx.target(type, id)
    const row = this.db.prepare(`SELECT * FROM ${entityTables[type]} WHERE id=?`).get(id)
    if (!row) throw new DataError('NOT_FOUND')
    return this.decode<T>(row)
  }
  insert(type: TargetType, value: object): void {
    const table = entityTables[type], fields = Object.entries(value)
    if ('id' in value && typeof value.id === 'string') this.tx.target(type, value.id)
    this.db.prepare(`INSERT INTO ${table}(${fields.map(([key]) => this.column(table, key)).join(',')}) VALUES(${fields.map(() => '?').join(',')})`)
      .run(...fields.map(([key, value]) => this.encode(table, key, value)))
  }
  save(type: TargetType, value: { id: string }): void {
    const table = entityTables[type], fields = Object.entries(value).filter(([key]) => key !== 'id')
    this.tx.target(type, value.id)
    this.db.prepare(`UPDATE ${table} SET ${fields.map(([key]) => `${this.column(table, key)}=?`).join(',')} WHERE id=?`)
      .run(...fields.map(([key, value]) => this.encode(table, key, value)), value.id)
  }
  remove(type: TargetType, id: string): void {
    this.tx.target(type, id)
    this.db.prepare(`DELETE FROM ${entityTables[type]} WHERE id=?`).run(id)
  }
  list<T>(table: string, where: string, args: SQLInputValue[], order: string, limit: number, offset: number): PageResult<T> {
    const total = Number(this.db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get(...args)?.count)
    const rows = this.db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return { items: rows.map((row) => this.decode<T>(row)), total }
  }
}
