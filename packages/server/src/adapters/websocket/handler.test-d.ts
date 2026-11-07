import type { WebSocketLike } from './handler.ts'

it('WebSocket is assignable to WebSocketLike', () => {
  const _assignable: WebSocketLike = {} as WebSocket
})
