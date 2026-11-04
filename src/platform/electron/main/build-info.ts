/** Replaced at build time; source-based hosts use null and never execute Git at runtime. */
declare const __JAB_BUILD_COMMIT__: string | null
export const buildCommit = typeof __JAB_BUILD_COMMIT__ === 'undefined' ? null : __JAB_BUILD_COMMIT__
