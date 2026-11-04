import { nativeTheme } from 'electron'
import type { ResolvedTheme, ThemePreference } from '../../../shared/settings'
import { themeBackgrounds, browserTransitionBackgrounds, browserCanvasBackgrounds } from '../../../shared/ui/theme-colors'

export function applyTheme(preference: ThemePreference): void {
  nativeTheme.themeSource = preference
}

export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function themeBackground(): string {
  return themeBackgrounds[resolvedTheme()]
}

export function browserTransitionBackground(): string {
  return browserTransitionBackgrounds[resolvedTheme()]
}

export function browserCanvasBackground(): string {
  return browserCanvasBackgrounds[resolvedTheme()]
}
