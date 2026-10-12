// Generated from design-tokens.json: npm run design:tokens
export const TAB_STRIP_HEIGHT = 48
export const TOOLBAR_HEIGHT = 48
export const BROWSER_CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT
export const SIDEBAR_WIDTH = 208
export const SIDEBAR_COMPACT_WIDTH = 64
export const SIDEBAR_BREAKPOINT = 960
export const getSidebarWidth = (width: number): number => width <= SIDEBAR_BREAKPOINT ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_WIDTH
