import { isWebSocketKeepAliveMessage, WEBSOCKET_KEEP_ALIVE_PING, WEBSOCKET_KEEP_ALIVE_PONG } from './keep-alive'

it('uses constant ping/pong frames', () => {
  expect(WEBSOCKET_KEEP_ALIVE_PING).toBe('ping')
  expect(WEBSOCKET_KEEP_ALIVE_PONG).toBe('pong')
})

describe('isWebSocketKeepAliveMessage', () => {
  const encoder = new TextEncoder()

  it.each([
    ['ping', 'ping', true],
    ['orpc:ping', 'orpc:ping', true],
    ['ping', 'orpc:ping', false],
    ['ping ', 'ping', false],
    ['{"id":"1","kind":"request"}', 'ping', false],
  ])('string %j matches %j: %s', (data, expected, matched) => {
    expect(isWebSocketKeepAliveMessage(data, expected)).toBe(matched)
    expect(isWebSocketKeepAliveMessage(encoder.encode(data), expected)).toBe(matched)
  })

  it('compares the UTF-8 bytes of non-ASCII prefixes', () => {
    expect(isWebSocketKeepAliveMessage(encoder.encode('🔌ping'), '🔌ping')).toBe(true)
    expect(isWebSocketKeepAliveMessage(encoder.encode('🔋ping'), '🔌ping')).toBe(false)
  })
})
