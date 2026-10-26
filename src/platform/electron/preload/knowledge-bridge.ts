import { knowledgeMethods, type KnowledgeAPI } from '../knowledge-contract'
export function createKnowledgeBridge(
  invoke: (method: string, input: unknown) => Promise<unknown>,
  subscribe: (callback: () => void) => () => void,
  flush: (callback: () => Promise<boolean>) => () => void
): KnowledgeAPI {
  return {
    ...Object.fromEntries(knowledgeMethods.map((method) => [method, (input: unknown) => invoke(method, input)])),
    onChanged: subscribe,
    onFlush: flush
  } as KnowledgeAPI
}
