import type { IncomingMessage, ServerResponse } from 'node:http'
import type { StandardHandlerPlugin } from '../standard'
import { ORPCError } from '@orpc/client'
import request from 'supertest'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

class Unserializable {
  toJSON(): never {
    throw new Error('not serializable')
  }
}

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

    const handler = new RPCHandler({}, { plugins: [plugin] })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    }).get('/test')

    expect(res.status).toBe(200)
    expect(res.body).toBe('intercepted')
  })

  it('treats GET requests as unmatched by default', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    })

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      const result = await handler.handle(req as any, response as any)

      if (!result.matched) {
        response.statusCode = 404
        response.end('not matched')
      }
    })
      .get(`/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`)

    expect(res.status).toBe(404)
    expect(res.text).toBe('not matched')
  })

  it('allows GET requests when allowMethods includes GET', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        allowMethods: ['GET'],
      },
    )

    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      await handler.handle(req as any, response as any)
    })
      .get(`/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`)

    expect(res.status).toBe(200)
    expect(res.text).toContain('pong')
  })

  it('responds with an empty 500 and resolves when the response body cannot be encoded', async () => {
    const onSendResponseError = vi.fn()
    const handler = new RPCHandler({
      ping: os.handler(() => {
        throw new ORPCError('BAD_REQUEST', { data: new Unserializable() })
      }),
    }, { onSendResponseError })

    let handled: Promise<unknown> | undefined
    const res = await request(async (req: IncomingMessage, response: ServerResponse) => {
      handled = handler.handle(req as any, response as any)
      await handled
    }).post('/ping').set('content-type', 'application/json').send({ json: null })

    expect(res.status).toBe(500)
    expect(res.text).toBe('')
    await expect(handled).resolves.toMatchObject({ matched: true })
    expect(onSendResponseError).toHaveBeenCalledExactlyOnceWith(new Error('not serializable'))
  })

  it('resolves without writing when the response is destroyed before sending (e.g. client reset)', async () => {
    const onSendResponseError = vi.fn()
    const resetError = new Error('client reset')
    const handler = new RPCHandler({
      ping: os
        .$context<{ response: ServerResponse }>()
        .handler(({ context }) => {
          context.response.destroy(resetError)
          return 'pong'
        }),
    }, { onSendResponseError })

    let handled: Promise<unknown> | undefined
    let end: ReturnType<typeof vi.spyOn> | undefined
    const res = request(async (req: IncomingMessage, response: ServerResponse) => {
      end = vi.spyOn(response, 'end')
      handled = handler.handle(req as any, response as any, { context: { response } })
      await handled
    }).post('/ping').set('content-type', 'application/json').send({ json: null })

    await expect(res).rejects.toThrow('socket hang up')
    await expect(handled).resolves.toMatchObject({ matched: true })
    expect(end).not.toHaveBeenCalled()
    expect(onSendResponseError).toHaveBeenCalledExactlyOnceWith(resetError)
  })
})
