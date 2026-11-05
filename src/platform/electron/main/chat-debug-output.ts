import type { ChatDebugBundle, ChatDebugOutput } from '../../../domain/chat/chat-debug.types'
import { fail } from '../../../domain/common/errors'

interface Clipboard { writeText(text: string): Promise<void>; readText(): Promise<string> }
/** Full data stays in Main. Success requires exact clipboard readback, including large payloads. */
export function createChatDebugOutput(clipboard: Clipboard, app: ChatDebugBundle['app'], now = () => new Date().toISOString()): ChatDebugOutput {
  return {
    async copy(data) {
      let text: string
      try {
        const bundle: ChatDebugBundle = { format: 'jab-debug', schemaVersion: 2, exportedAt: now(), app, ...data }
        text = JSON.stringify(bundle, null, 2)
      } catch { fail('DEBUG_SERIALIZATION_FAILED') }
      try {
        await clipboard.writeText(text)
        if (await clipboard.readText() !== text) fail('CLIPBOARD_FAILED')
      } catch { fail('CLIPBOARD_FAILED') }
      return null
    }
  }
}
