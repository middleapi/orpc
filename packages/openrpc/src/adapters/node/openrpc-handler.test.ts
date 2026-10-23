import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { os } from '@orpc/server'
import request from 'supertest'
import { OpenRPCHandler } from './openrpc-handler'

describe('openRPCHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const handler = new OpenRPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })
    }).post('/api/v1').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: 'u_123' })

    const mismatchRes = await request(async (req: IncomingMessage, response: ServerResponse) => {
      const result = await handler.handle(req as any, response as any, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })

      if (!result.matched) {
        response.statusCode = 404
        response.end('not matched')
      }
    }).post('/invalid').set('content-type', 'application/json').send({ jsonrpc: '2.0', method: 'ping', id: 1 })

    expect(mismatchRes.status).toBe(404)
    expect(mismatchRes.text).toBe('not matched')
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
