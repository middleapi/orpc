/**
 * Keep-alive frames are plain text outside the peer protocol, so they never reach the peer
 * and stay byte-for-byte constant. This lets runtimes answer pings without running user code,
 * e.g. Cloudflare's `setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`.
 *
 * When a `prefix` is configured for encoding/decoding peer messages, it is prepended to these too.
 *
 * @see {@link https://orpc.dev/docs/adapters/websocket#keep-alive | WebSocket Keep-Alive}
 */
export const WEBSOCKET_KEEP_ALIVE_PING = 'ping'
export const WEBSOCKET_KEEP_ALIVE_PONG = 'pong'

const textEncoder = new TextEncoder()

/**
 * Whether `data` is exactly the keep-alive frame `expected`, as text or as its UTF-8 bytes
 * (some servers, like uWebSockets.js, deliver text frames as bytes).
 */
export function isWebSocketKeepAliveMessage(data: string | Uint8Array, expected: string): boolean {
  if (typeof data === 'string') {
    return data === expected
  }

  const bytes = textEncoder.encode(expected)
  return data.byteLength === bytes.byteLength && data.every((byte, index) => byte === bytes[index])
}
