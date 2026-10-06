import { createInstance } from 'i18next'
import { resources, translationOptions } from './config'

/** Bundled resources initialize synchronously, including before native startup dialogs. */
export function createTranslationInstance() {
  const instance = createInstance()
  void instance.init({ ...translationOptions, resources: structuredClone(resources) })
  return instance
}

// Each process gets its own instance; Renderer shares this with its React provider.
export const i18n = createTranslationInstance()
export const t = i18n.t
