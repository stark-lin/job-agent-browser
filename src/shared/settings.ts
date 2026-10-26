import type { KnowledgePreferences } from './knowledge-settings'
import { defaultAISettings, type AISettings } from './ai'

export type Language = 'en' | 'zh-CN'
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type MailProvider = 'none' | 'gmail' | 'outlook' | 'custom'
export interface Mailbox { provider: MailProvider; url: string }
export interface Preferences { version: 1; theme: ThemePreference; language: Language; mailbox: Mailbox; ai: AISettings; knowledge?: KnowledgePreferences }
export type PreferencePatch = { language?: Language; theme?: ThemePreference; mailbox?: Mailbox; ai?: AISettings; knowledge?: KnowledgePreferences }
export const defaultPreferences: Preferences = { version: 1, theme: 'light', language: 'en', mailbox: { provider: 'none', url: '' }, ai: defaultAISettings }
export const mailURLs = { gmail: 'https://mail.google.com/', outlook: 'https://outlook.live.com/mail/' } as const
