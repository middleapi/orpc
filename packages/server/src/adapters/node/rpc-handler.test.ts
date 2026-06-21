import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NodeHttpHandlerPlugin } from './plugin'
import request from 'supertest'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

describe('rpcHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const handler = new RPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })
    }).post('/api/v1/ping').set('content-type', 'application/json').send({ json: null })

    expect(res.status).toBe(200)
    expect(res.text).toContain('u_123')

    const mismatchRes = await request(async (req: IncomingMessage, response: ServerResponse) => {
      const result = await handler.handle(req as any, response as any, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })

      if (!result.matched) {
        response.statusCode = 404
        response.end('not matched')
      }
    }).post('/invalid/ping').set('content-type', 'application/json').send({ json: null })

    expect(mismatchRes.status).toBe(404)
    expect(mismatchRes.text).toBe('not matched')
  })

  it('supports node http handler plugin', async () => {
    const plugin: NodeHttpHandlerPlugin<any> = {
      name: 'test',
      initNodeHttpHandlerOptions(options) {
        return {
          ...options,
          nodeHttpInterceptors: [
            async ({ response }) => {
              response.statusCode = 200
              response.end('intercepted')

              return { matched: true }
            },
          ],
        }
      },
    }

    const handler = new RPCHandler({}, { plugins: [plugin] })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    }).get('/test')

    expect(res.status).toBe(200)
    expect(res.text).toBe('intercepted')
  })

  it('enables csrfGuardPlugin by default', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    })

    let result: Awaited<ReturnType<typeof handler.handle>> | undefined

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      result = await handler.handle(req as any, response as any)

      if (!result.matched) {
        response.statusCode = 404
        response.end('not matched')
      }
    })
      .post('/ping')
      .set('content-type', 'application/json')
      .set('cookie', 'session=abc')
      .set('sec-fetch-mode', 'navigate')
      .send({ json: null })

    expect(res.status).toBe(403)
    expect(res.text).toContain('Request blocked by CSRF protection')
  })

  it('disables csrfGuardPlugin when configured', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        csrfGuardPlugin: {
          enabled: false,
        },
      },
    )

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    })
      .post('/ping')
      .set('content-type', 'application/json')
      .set('cookie', 'session=abc')
      .set('sec-fetch-mode', 'navigate')
      .send({ json: null })

    expect(res.status).toBe(200)
    expect(res.text).toContain('pong')
  })
})
