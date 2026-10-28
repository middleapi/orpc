import { tryOrUndefined } from '@orpc/shared'

const textDecoder = new TextDecoder()

/**
 * Parses a WebSocket message as JSON, or returns `undefined` when it is not valid JSON.
 */
export function parseJsonMessage(message: string | Uint8Array): unknown {
  return tryOrUndefined(() => JSON.parse(typeof message === 'string' ? message : textDecoder.decode(message)))
}
