/** Public identities never contain physical storage locations. */
export type SpaceId = 'knowledge' | 'memory'
export interface NoteSelection { space: SpaceId; path: string }
export const noteKey = ({ space, path }: NoteSelection) => `${space}:${path}`
