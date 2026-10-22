import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { FastifyInstance } from 'fastify'
import { os } from '@orpc/server'
import Fastify from 'fastify'
import request from 'supertest'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'

describe('openRPCHandler', () => {
  let app: FastifyInstance

  const router = {
    ping: os
      .$context<{ userId: string }>()
      .handler(({ context }) => `pong ${context.userId}`),
    planet: {
      find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
    },
  }

  const handler = new OpenRPCHandler(router)

  function mount(app: FastifyInstance) {
    app.all('/*', async (req, reply) => {
      const result = await handler.handle(req, reply, {
        context: { userId: 'u_123' },
        prefix: '/rpc',
      })

      if (!result.matched) {
        return reply.status(404).send('not matched')
      }

      return reply
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    app = Fastify()
  })

  afterEach(async () => {
    await app.close()
  })

  it('answers a single call, a batch, and a notification', async () => {
    mount(app)
    await app.ready()

    const single = await request(app.server).post('/rpc').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })
    expect(single.status).toBe(200)
    expect(single.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong u_123' })

    const batch = await request(app.server).post('/rpc').set('content-type', 'application/json').send([
      { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 },
      { jsonrpc: '2.0', method: 'ping' },
    ])
    expect(batch.status).toBe(200)
    expect(batch.body).toEqual([{ jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } }])

    const notification = await request(app.server).post('/rpc').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping' })
    expect(notification.status).toBe(204)
    expect(notification.text).toBe('')
  })

  it('rejects other content types with 415', async () => {
    mount(app)
    await app.ready()

    const res = await request(app.server).post('/rpc').set('content-type', 'text/plain').send('{"jsonrpc":"2.0","method":"ping","id":1}')

    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32015 } })
  })

  it('passes requests outside the endpoint through', async () => {
    mount(app)
    await app.ready()

    const res = await request(app.server).post('/rpc/ping').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(404)
    expect(res.text).toBe('not matched')
  })

  it('answers invalid JSON with "Parse error" and accepts application/json-rpc with a catch-all parser', async () => {
    app.removeAllContentTypeParsers()
    app.addContentTypeParser('*', (_request, _payload, done) => {
      done(null, undefined)
    })
    mount(app)
    await app.ready()

    const invalid = await request(app.server).post('/rpc').set('content-type', 'application/json').send('{"jsonrpc": "2.0", "method"')
    expect(invalid.status).toBe(200)
    expect(invalid.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })

    const empty = await request(app.server).post('/rpc').set('content-type', 'application/json').send('')
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })

    const jsonRpc = await request(app.server).post('/rpc').set('content-type', 'application/json-rpc').send('{"jsonrpc":"2.0","method":"ping","id":1}')
    expect(jsonRpc.status).toBe(200)
    expect(jsonRpc.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong u_123' })
  })

  it('leaves invalid JSON to Fastify without a catch-all parser', async () => {
    mount(app)
    await app.ready()

    const res = await request(app.server).post('/rpc').set('content-type', 'application/json').send('{"jsonrpc": "2.0", "method"')

    expect(res.status).toBe(400)
    expect(res.body).not.toHaveProperty('jsonrpc')
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
