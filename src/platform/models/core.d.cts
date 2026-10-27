export interface ModelFile { path: string; size: number; sha256: string }
export interface ModelManifest { id: string; source: string; revision: string; files: ModelFile[] }
export function prepare(options: { directory: string; model: ModelManifest; verify?: boolean; fetcher?: typeof fetch; signal?: AbortSignal; onProgress?(completed: number, total: number): void; seed?: string }): Promise<string>
export function verifyFile(directory: string, file: ModelFile): Promise<boolean>
export function safeParents(directory: string, relative: string): Promise<void>
