import { en } from './i18n/locales/en'
import { t } from './i18n'

export const internalPages = en.navigation.pages

export type InternalPage = keyof typeof internalPages
export type Destination = { kind: 'internal'; page: InternalPage } | { kind: 'web'; url: string }

export function parseInternalURL(input: string): Destination {
  const match = /^app:\/\/([a-z-]+)\/?$/.exec(input.trim())
  if (!match || !Object.hasOwn(internalPages, match[1])) throw new Error(t($ => $.errors.unknownPage))
  return { kind: 'internal', page: match[1] as InternalPage }
}

export function isBrowserDestination(destination: Destination): boolean {
  return destination.kind === 'web' || destination.page === 'browser'
}
