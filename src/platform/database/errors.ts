import { DataError, type ErrorCode } from '../../domain/common/errors'

/** SQLite exception messages can contain SQL/data. Classify using numeric codes only. */
export function storageError(error: unknown): DataError {
  if (error instanceof DataError) return error
  const code = error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) & 0xff : 0
  const mapped: ErrorCode = code === 5 || code === 6 ? 'STORAGE_BUSY' : code === 19 ? 'CONFLICT' : 'STORAGE_UNAVAILABLE'
  return new DataError(mapped)
}
