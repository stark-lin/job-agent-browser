import { fail } from '../../domain/common/errors'

/** Fallback for backends without host storage adapters. Production injects real file services. */
export const storageScaffold = {
  settings: { get: (_input: unknown) => fail('NOT_IMPLEMENTED'), savePreferences: (_input: unknown) => fail('NOT_IMPLEMENTED') },
  secrets: { hasProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED'), saveProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED'), deleteProviderKey: (_input: unknown) => fail('NOT_IMPLEMENTED') }
}
