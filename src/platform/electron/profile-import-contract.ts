import type { Result } from '../../shared/ipc'
import type { AIChoice, AIError } from '../../shared/ai'
import type { ImportDraft } from '../../domain/candidate/import.types'

export type ImportError = AIError | 'INVALID_STATE' | 'NOT_FOUND' | 'CONFLICT' | 'PDF_TOO_LARGE' | 'PDF_TOO_MANY_PAGES' | 'PDF_TOO_MUCH_TEXT' | 'PDF_ENCRYPTED' | 'PDF_INVALID' | 'PDF_NO_TEXT' | 'IMPORT_INVALID_OUTPUT' | 'IMPORT_NOT_FOUND'
export interface PdfSelection { fileId: string; bytes: number }
export interface ImportTask { sessionId: string; taskId: string }
export type ImportEvent = ImportTask & (
  { type: 'phase'; phase: 'extracting' | 'parsing'; page?: number; pages?: number }
  | { type: 'ready'; draft: ImportDraft }
  | { type: 'failed'; error: ImportError }
  | { type: 'cancelled' }
)
export interface ProfileImportAPI {
  selectPdf(): Promise<Result<PdfSelection | null, ImportError>>
  start(input: { fileId: string; choice: AIChoice }): Promise<Result<ImportTask, ImportError>>
  cancel(input: { sessionId: string }): Promise<Result<null, ImportError>>
  discard(input: { fileId?: string; sessionId?: string }): Promise<Result<null, ImportError>>
  onEvent(callback: (event: ImportEvent) => void): () => void
}
