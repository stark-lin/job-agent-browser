import type { Preferences } from './settings'

export interface SmartPasteConfig { id: string; title: string; prompt: string }
export interface SmartPasteSettings { configs: SmartPasteConfig[] }
export const SMART_PASTE_CONFIG_LIMIT = 20
export const SMART_PASTE_TITLE_LIMIT = 120
export const SMART_PASTE_PROMPT_LIMIT = 16000

const defaultId = '3f7902fa-f022-48fc-bc79-136228ec4a7d'
export function smartPasteSettings({ language, smartPaste }: Pick<Preferences, 'language' | 'smartPaste'>): SmartPasteSettings {
  return smartPaste ?? { configs: [{ id: defaultId, ...(language === 'zh-CN'
    ? { title: '个人简介', prompt: '根据剪贴板、字段要求和我的已有资料，生成可直接填写的个人简介。不要虚构经历。' }
    : { title: 'Personal introduction', prompt: 'Write a personal introduction for this field using the clipboard, field requirements, and my saved information. Do not invent experience.' }) }] }
}
