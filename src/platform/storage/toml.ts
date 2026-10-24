import type * as TOML from 'smol-toml' with { 'resolution-mode': 'import' }

// The package ships CommonJS at runtime, but its declaration export is ESM-only.
// Keep the adapter compatible with both the Node16 test build and Electron CJS.
const toml = require('smol-toml') as typeof TOML
export const parseTOML = toml.parse
export const stringifyTOML = toml.stringify
