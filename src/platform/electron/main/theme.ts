import { nativeTheme } from 'electron'
import type { ResolvedTheme, ThemePreference } from '../../../shared/settings'
// Neutral theme body and browser canvas colors for native view transitions.
const themeBackgrounds = { light: '#f1f1f1', dark: '#1b1b1b' }
const browserCanvasBackgrounds = { light: '#e2e2e2', dark: '#303030' }

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
  return browserCanvasBackgrounds[resolvedTheme()]
}

export function browserCanvasBackground(): string {
  return browserCanvasBackgrounds[resolvedTheme()]
}
