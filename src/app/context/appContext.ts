import type { Destination } from '../../shared/navigation'

export interface ContextReferences {
  jobId: string | null
  profileId: string | null
  artifactId: string | null
}

export interface AppContext extends ContextReferences {
  currentPage: { tabId: string; title: string; destination: Destination } | null
}
