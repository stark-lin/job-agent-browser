export interface KnowledgePreferences {
  mode: 'edit' | 'split' | 'preview'
  explorerWidth: number
  remote: string
  branch: string
  semanticEnabled: boolean
  providerId: string
  modelId: string
}
export const defaultKnowledgePreferences: KnowledgePreferences = {
  mode: 'split',
  explorerWidth: 256,
  remote: '',
  branch: 'main',
  semanticEnabled: false,
  providerId: '',
  modelId: ''
}
