import { useEffect, useRef } from 'react'
import { useServices } from '../providers'
import { AIStreamClient } from './streamClient'

export function useAIRequest() {
  const { ai } = useServices(), client = useRef<AIStreamClient | null>(null)
  useEffect(() => {
    const instance = new AIStreamClient(ai); client.current = instance
    return () => { instance.dispose(); if (client.current === instance) client.current = null }
  }, [ai])
  return client
}
