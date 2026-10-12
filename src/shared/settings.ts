export type Language = 'en' | 'zh-CN'
export type MailProvider = 'none' | 'gmail' | 'outlook' | 'custom'
export interface Mailbox { provider: MailProvider; url: string }
export interface Preferences { version: 1; theme: 'light'; language: Language; mailbox: Mailbox }
export type PreferencePatch = { language?: Language; theme?: 'light'; mailbox?: Mailbox }
export const defaultPreferences: Preferences = { version: 1, theme: 'light', language: 'en', mailbox: { provider: 'none', url: '' } }
export const mailURLs = { gmail: 'https://mail.google.com/', outlook: 'https://outlook.live.com/mail/' } as const
