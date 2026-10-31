import { os } from '@orpc/server'
import { OpenRPCHandler } from './openrpc-handler'

it('requires the initial context in message and upgrade', () => {
  const handler = new OpenRPCHandler({ ping: os.$context<{ userId: string }>().handler(() => 'pong') })
  const ws = {} as WebSocket

  handler.message(ws, '', { context: { userId: 'u_123' }, prefix: '/api' })
  handler.upgrade(ws, { context: async () => ({ userId: 'u_123' }) })
  // @ts-expect-error - missing context
  handler.message(ws, '')
  // @ts-expect-error - missing context
  handler.upgrade(ws)
  // @ts-expect-error - invalid context
  handler.upgrade(ws, { context: { userId: 123 } })
})
