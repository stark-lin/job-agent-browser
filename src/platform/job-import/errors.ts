import type { JobImportError } from '../electron/job-import-contract'
export class JobImportFailure extends Error {
  constructor(readonly code: JobImportError) { super(code) }
}
