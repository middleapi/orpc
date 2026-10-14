import type { WebSocket as WsWebSocket } from 'ws'
import type { WebSocketLike } from './handler'

it('WebSocket is assignable to WebSocketLike', () => {
  const _assignable: WebSocketLike = {} as WebSocket
})

it('"ws" WebSocket is assignable to WebSocketLike', () => {
  const _assignable: WebSocketLike = {} as WsWebSocket
})

it('Bun and uWebSockets.js style WebSockets are assignable to WebSocketLike', () => {
  const _bun: WebSocketLike = {} as { send: (data: string | Uint8Array) => number, getBufferedAmount: () => number, readyState: 0 | 1 | 2 | 3 }
  const _uws: WebSocketLike = {} as { send: (data: string | Uint8Array, isBinary?: boolean) => number, getBufferedAmount: () => number }
})
