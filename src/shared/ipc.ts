export type Result<T, E extends string = string> = { ok: true; value: T } | { ok: false; error: E }
export const DATA_CALL = 'data:call'
