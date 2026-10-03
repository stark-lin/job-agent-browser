import { fail } from '../../domain/common/errors'

/** Explicit scaffold: callers must handle NOT_IMPLEMENTED; no settings/secrets files are created. */
export const storageScaffold = {
  settings: { get: (_input: unknown) => fail('NOT_IMPLEMENTED'), savePreferences: (_input: unknown) => fail('NOT_IMPLEMENTED') },
  secrets: { hasProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED'), saveProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED'), deleteProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED') }
}
