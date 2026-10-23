import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { FastifyInstance } from 'fastify'
import { os } from '@orpc/server'
import Fastify from 'fastify'
import request from 'supertest'
import { OpenRPCHandler } from './openrpc-handler'

describe('openRPCHandler', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    app = Fastify()
  })

  afterEach(async () => {
    await app.close()
  })

  it('accepts context and prefix options in handle method', async () => {
    const handler = new OpenRPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    app.all('/*', async (req, reply) => {
      const result = await handler.handle(req, reply, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })

      if (!result.matched) {
        return reply.status(404).send('not matched')
      }

      return reply
    })

    await app.ready()

    const res = await request(app.server).post('/api/v1').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'u_123' })

    const mismatchRes = await request(app.server).post('/invalid').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(mismatchRes.status).toBe(404)
    expect(mismatchRes.text).toBe('not matched')
  })

  it('reads batches Fastify has already parsed', async () => {
    const handler = new OpenRPCHandler({ ping: os.handler(() => 'pong') })

    app.all('/*', async (req, reply) => {
      await handler.handle(req, reply)
      return reply
    })

    await app.ready()

    const res = await request(app.server).post('/').set('content-type', 'application/json').send([
      { jsonrpc: '2.0', method: 'ping', id: 1 },
      { jsonrpc: '2.0', method: 'ping', id: 2 },
    ])

    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'pong' },
      { jsonrpc: '2.0', id: 2, result: 'pong' },
    ])
  })

  it('supports standard handler plugins', async () => {
    const plugin: StandardHandlerPlugin<any> = {
      name: 'test',
      init(options) {
        return {
          ...options,
          routingInterceptors: [
            async () => ({ matched: true, response: { status: 200, headers: {}, body: 'intercepted' } }),
          ],
        }
      },
    }

    const handler = new OpenRPCHandler({}, { plugins: [plugin] })

    app.all('/*', async (req, reply) => {
      await handler.handle(req, reply)
      return reply
    })

    await app.ready()

    const res = await request(app.server).get('/test')

    expect(res.status).toBe(200)
    expect(res.body).toBe('intercepted')
  })
})
