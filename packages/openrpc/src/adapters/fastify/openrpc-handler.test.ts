import { os } from '@orpc/server'
import Fastify from 'fastify'
import request from 'supertest'
import { OpenRPCHandler } from './openrpc-handler'

it('openRPCHandler serves JSON-RPC with Fastify', async () => {
  const handler = new OpenRPCHandler({ ping: os.$context<{ user: string }>().handler(({ context }) => context.user) })
  const app = Fastify()

  app.all('/*', async (req, reply) => {
    const { matched } = await handler.handle(req, reply, { prefix: '/rpc', context: { user: 'u_1' } })
    return matched ? reply : reply.status(404).send()
  })

  try {
    await app.ready()
    const res = await request(app.server).post('/rpc').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'u_1' })
  }
  finally {
    await app.close()
  }
})
