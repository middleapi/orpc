import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NodeHttpHandlerNodeHttpInterceptorOptions } from './handler'
import { Buffer } from 'node:buffer'
import request from 'supertest'
import { os } from '../../builder'
import { BodyLimitHandlerPlugin } from './body-limit-plugin'
import { RPCHandler } from './rpc-handler'

describe('bodyLimitHandlerPlugin', () => {
  const size22Json = { json: { foo: 'bar' } }
  const toRequestListener = (handler: RPCHandler<any>) => async (req: IncomingMessage, response: ServerResponse) => {
    const result = await handler.handle(req as any, response as any)

    if (!result.matched) {
      response.statusCode = 404
      response.end('not matched')
    }
  }

  it('ignores requests without a body', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const res = await request(toRequestListener(handler)).get('/ping?data=%7B%7D')

    expect(res.status).toBe(200)
    expect(res.text).toContain('ping')
  })

  it('allows bodies within the limit', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 22 })],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('content-type', 'application/json')
      .send(size22Json)

    expect(res.status).toBe(200)
    expect(res.text).toContain('ping')
  })

  it('checks the content-length header', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('content-type', 'application/json')
      .set('content-length', '22')
      .send({})

    expect(res.status).toBe(413)
    expect(res.text).toContain('PAYLOAD_TOO_LARGE')
  })

  it('checks the streamed body size', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'ping'),
      },
      {
        plugins: [new BodyLimitHandlerPlugin({ maxBodySize: 21 })],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('content-type', 'application/json')
      .send(size22Json)

    expect(res.status).toBe(413)
    expect(res.text).toContain('PAYLOAD_TOO_LARGE')
  })

  it('handles repeated data events and restores emit after streamed overflow', async () => {
    const plugin = new BodyLimitHandlerPlugin({ maxBodySize: 1 })
    const interceptor = plugin.initNodeHttpHandlerOptions({}).nodeHttpInterceptors![0]!

    const originalEmit = vi.fn().mockReturnValue('__EMITTED__')
    const request = {
      headers: {
        'content-length': '1',
      },
      emit: originalEmit,
    }

    await expect(interceptor({
      request,
      response: {} as any,
      context: {} as any,
      prefix: undefined,
      path: '/ping',
      procedure: {} as any,
      sendStandardResponseOptions: undefined,
      next: async (interceptorOptions: NodeHttpHandlerNodeHttpInterceptorOptions<any>) => {
        expect(interceptorOptions.request.emit('data', Buffer.from('a'))).toBe('__EMITTED__')
        expect(interceptorOptions.request.emit('data')).toBe('__EMITTED__')
        interceptorOptions.request.emit('data', Buffer.from('b'))

        return { matched: true }
      },
    } as any)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    })

    expect(request.emit).toBe(originalEmit)
  })
})
