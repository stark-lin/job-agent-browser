export interface BannerEvent {
  timeUs: string
  title: string
  detail: string
  action?: { type: 'open-ask-session'; sessionId: string }
}

export const BANNER_STATE = 'banner:state'
export const BANNER_INTERACTION = 'banner:interaction'
