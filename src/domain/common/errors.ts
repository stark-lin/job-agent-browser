export const errorCodes = [
  'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'INVALID_STATE', 'STORAGE_BUSY',
  'STORAGE_UNAVAILABLE', 'AUDIT_UNAVAILABLE', 'NOT_IMPLEMENTED', 'FORBIDDEN'
] as const
export type ErrorCode = typeof errorCodes[number]

/** Only codes cross the IPC/audit boundary; exception text may contain private data. */
export class DataError extends Error {
  constructor(readonly code: ErrorCode) { super(code) }
}

export function fail(code: ErrorCode): never { throw new DataError(code) }

export function errorCode(error: unknown): ErrorCode {
  return error instanceof DataError ? error.code : 'STORAGE_UNAVAILABLE'
}
