import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ORPCError, os } from '@orpc/server'
import request from 'supertest'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'

describe('openapiHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends error responses with errorResponseContentType', async () => {
    const handler = new OpenAPIHandler({
      ping: os.handler(() => {
        throw new ORPCError('NOT_FOUND')
      }),
    }, { errorResponseContentType: 'application/problem+json' })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    }).post('/ping')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toBe('application/problem+json')
    expect(res.headers['standard-server']).toBeUndefined()
    expect(JSON.parse(res.text)).toEqual(new ORPCError('NOT_FOUND').toJSON())
  })

  it('accepts context and prefix options in handle method', async () => {
    const handler = new OpenAPIHandler({
      ping: os
        .$context<{ userId: string }>()
        .meta(openapi({ method: 'POST', path: '/ping/pong' }))
        .handler(({ context }) => context.userId),
    })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any, {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      })
    }).post('/api/v1/ping/pong').set('content-type', 'application/json').send({ json: null })

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

    const handler = new OpenAPIHandler({}, { plugins: [plugin] })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    }).get('/test')

    expect(res.status).toBe(200)
    expect(res.body).toBe('intercepted')
  })
})
