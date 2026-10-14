import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { onError, os } from '@orpc/server'
import request from 'supertest'
import z from 'zod'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'

describe('openapiHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

describe('openapiHandler: invalid detailed-output headers', () => {
  const router = {
    download: os
      .meta(openapi({ method: 'GET', path: '/download', outputStructure: 'detailed' }))
      .input(z.object({ name: z.string() }))
      .handler(({ input }) => ({
        headers: { 'content-disposition': `attachment; filename="${input.name}"` },
        body: 'file-content',
      })),
    redirect: os
      .meta(openapi({ method: 'GET', path: '/redirect', successStatus: 307, outputStructure: 'detailed' }))
      .input(z.object({ to: z.string().startsWith('/') }))
      .handler(({ input }) => ({ headers: { location: input.to } })),
  }

  it.each([
    ['/api/download?name=%E6%97%A5.txt'], // code point above U+00FF
    ['/api/redirect?to=%2F%0D%0ASet-Cookie:%20a=b'], // CRLF
  ])('responds 500 and calls onError instead of rejecting for %s', async (url) => {
    const onErrorSpy = vi.fn()
    const handler = new OpenAPIHandler(router, { interceptors: [onError(onErrorSpy)] })
    let handleError: unknown

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      try {
        await handler.handle(req as any, response as any, { prefix: '/api' })
      }
      catch (e) {
        handleError = e
      }
    }).get(url)

    expect(handleError).toBeUndefined()
    expect(res.status).toBe(500)
    expect(onErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('still sends valid headers', async () => {
    const handler = new OpenAPIHandler(router)
    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any, { prefix: '/api' })
    }).get('/api/download?name=a.txt')

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe('attachment; filename="a.txt"')
  })
})
