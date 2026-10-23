import type { ResumeAPI, ResumeEvent } from '../resume-contract'
import type { Result } from '../../../shared/ipc'

export function createResumeBridge(invoke: (method: string, input: unknown) => Promise<Result<unknown>>, subscribe: (callback: (event: ResumeEvent) => void) => () => void): ResumeAPI {
  return {
    start: input => invoke('start', input) as ReturnType<ResumeAPI['start']>,
    getTask: input => invoke('getTask', input) as ReturnType<ResumeAPI['getTask']>,
    cancel: input => invoke('cancel', input) as ReturnType<ResumeAPI['cancel']>,
    retryOutput: input => invoke('retryOutput', input) as ReturnType<ResumeAPI['retryOutput']>,
    getPreview: input => invoke('getPreview', input) as ReturnType<ResumeAPI['getPreview']>,
    exportPdf: input => invoke('exportPdf', input) as ReturnType<ResumeAPI['exportPdf']>,
    onEvent: subscribe
  }
}
