import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { os } from '@orpc/server'
import request from 'supertest'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'

describe('openRPCHandler', () => {
  const router = {
    ping: os
      .$context<{ userId: string }>()
      .handler(({ context }) => `pong ${context.userId}`),
    planet: {
      find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
    },
  }

  const handler = new OpenRPCHandler(router)

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const result = await handler.handle(req as any, res as any, {
      context: { userId: 'u_123' },
      prefix: '/rpc',
    })

    if (!result.matched) {
      res.statusCode = 404
      res.end('not matched')
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers a single call', async () => {
    const res = await request(handle)
      .post('/rpc')
      .set('content-type', 'application/json')
      .send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong u_123' })
  })

  it('answers a batch', async () => {
    const res = await request(handle)
      .post('/rpc')
      .set('content-type', 'application/json')
      .send([
        { jsonrpc: '2.0', method: 'planet.find', params: [{ id: 1 }], id: 1 },
        { jsonrpc: '2.0', method: 'ping' },
        { jsonrpc: '2.0', method: 'unknown', id: 2 },
      ])

    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } },
    ])
  })

  it('answers notifications with 204 and no body', async () => {
    const res = await request(handle)
      .post('/rpc')
      .set('content-type', 'application/json')
      .send({ jsonrpc: '2.0', method: 'ping' })

    expect(res.status).toBe(204)
    expect(res.headers['content-type']).toBeUndefined()
    expect(res.text).toBe('')
  })

  it('rejects other content types with 415', async () => {
    const res = await request(handle)
      .post('/rpc')
      .set('content-type', 'text/plain')
      .send('{"jsonrpc":"2.0","method":"ping","id":1}')

    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32015 } })
  })

  it('answers invalid JSON with "Parse error"', async () => {
    const res = await request(handle)
      .post('/rpc')
      .set('content-type', 'application/json-rpc')
      .send('{"jsonrpc": "2.0", "method"')

    expect(res.status).toBe(200)
    expect(JSON.parse(res.text)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  })

  it('passes requests outside the endpoint through', async () => {
    const res = await request(handle)
      .post('/rpc/ping')
      .set('content-type', 'application/json')
      .send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(404)
    expect(res.text).toBe('not matched')
  })

  it('uses a body a body parser such as express.json() already parsed', async () => {
    const res = await request(async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
      // what express.json() does: consume the stream and expose the parsed body
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      req.body = JSON.parse(Buffer.concat(chunks).toString())

      await handle(req, res)
    })
      .post('/rpc')
      .set('content-type', 'application/json')
      .send([{ jsonrpc: '2.0', method: 'ping', id: 1 }])

    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ jsonrpc: '2.0', id: 1, result: 'pong u_123' }])
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

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    }).get('/test')

    expect(res.status).toBe(200)
    expect(res.body).toBe('intercepted')
  })
})
