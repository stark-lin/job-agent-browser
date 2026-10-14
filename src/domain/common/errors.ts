export const errorCodes = [
  'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'INVALID_STATE', 'STORAGE_BUSY',
  'STORAGE_UNAVAILABLE', 'AUDIT_UNAVAILABLE', 'NOT_IMPLEMENTED', 'FORBIDDEN', 'ENCRYPTION_UNAVAILABLE',
  'AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_RATE_LIMITED', 'AI_PROVIDER_FAILED', 'AI_PROTOCOL_ERROR',
  'AI_CONNECT_FAILED', 'AI_TIMEOUT', 'AI_CANCELLED'
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
