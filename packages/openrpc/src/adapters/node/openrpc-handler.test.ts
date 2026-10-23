import type { IncomingMessage, ServerResponse } from 'node:http'
import { os } from '@orpc/server'
import request from 'supertest'
import { OpenRPCHandler } from './openrpc-handler'

it('openRPCHandler serves JSON-RPC over Node.js HTTP', async () => {
  const handler = new OpenRPCHandler({ ping: os.$context<{ user: string }>().handler(({ context }) => context.user) })

  const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
    const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: { user: 'u_1' } })

    if (!matched) {
      res.statusCode = 404
      res.end()
    }
  }).post('/rpc').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

  expect(res.status).toBe(200)
  expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'u_1' })
})
