import { useEffect } from 'react'
import { useNavigation } from './navigate'
import { useServices } from '../providers'

export function useUnsavedGuard(dirty: boolean) {
  const { navigation } = useServices(), { active } = useNavigation()
  const tabId = active?.id, targetId = active?.targetId
  useEffect(() => {
    if (!tabId || !targetId) return
    void navigation.api.setUnsaved(dirty, { tabId, targetId }).catch(() => {})
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = 'unsaved' } }
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('beforeunload', unload)
      void navigation.api.setUnsaved(false, { tabId, targetId }).catch(() => {})
    }
  }, [dirty, navigation, tabId, targetId])
}
