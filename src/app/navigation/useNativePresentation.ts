import { useEffect } from 'react'
import { useNavigation } from './navigate'
import { useServices } from '../providers'

/** The page that owns a native surface acknowledges its tab/target after React commits. */
export function useNativePresentation(visible = true): void {
  const { active } = useNavigation(), { navigation } = useServices()
  const tabId = active?.id, targetId = active?.targetId
  useEffect(() => {
    if (!tabId || !targetId) return
    const presentation = { tabId, targetId }
    void navigation.api.setVisible(visible, presentation).catch(reason => { void navigation.run(async () => { throw reason }) })
    return () => { void navigation.api.setVisible(false, presentation).catch(() => {}) }
  }, [navigation, tabId, targetId, visible])
}
