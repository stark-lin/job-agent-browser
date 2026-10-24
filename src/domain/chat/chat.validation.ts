import * as v from '../common/validation'
export const chatChoice = v.object({ providerId: v.text(100, 1), modelId: v.text(200, 1) })
export const chatStart = v.object({ requestId: v.id, sessionId: v.optional(v.id, ''), message: v.text(128000, 1), choice: chatChoice })
