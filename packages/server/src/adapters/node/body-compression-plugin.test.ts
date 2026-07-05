import type { IncomingMessage, ServerResponse } from 'node:http'
import request from 'supertest'
import { os } from '../../builder'
import { BodyCompressionHandlerPlugin } from './body-compression-plugin'
import { RPCHandler } from './rpc-handler'

describe('bodyCompressionHandlerPlugin', () => {
  const largeText = 'x'.repeat(2000)

  const toRequestListener = (handler: RPCHandler<any>) => async (req: IncomingMessage, response: ServerResponse) => {
    const result = await handler.handle(req as any, response as any)

    if (!result.matched) {
      response.statusCode = 404
      response.end('not matched')
    }
  }

  it('compresses responses when the client accepts gzip', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => largeText),
      },
      {
        plugins: [new BodyCompressionHandlerPlugin()],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('accept-encoding', 'gzip, deflate')
      .set('content-type', 'application/json')
      .send({ json: null })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
  })

  it('does not compress responses when the client does not accept compression', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => largeText),
      },
      {
        plugins: [new BodyCompressionHandlerPlugin()],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('accept-encoding', 'identity')
      .set('content-type', 'application/json')
      .send({ json: null })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.text).toContain(largeText)
  })

  it('uses the custom filter override when provided', async () => {
    const filter = vi.fn(() => true)

    const handler = new RPCHandler(
      {
        ping: os.handler(() => largeText),
      },
      {
        plugins: [new BodyCompressionHandlerPlugin({ filter })],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('accept-encoding', 'gzip')
      .set('content-type', 'application/json')
      .send({ json: null })

    expect(res.status).toBe(200)
    expect(filter).toHaveBeenCalledOnce()
    expect(res.headers['content-encoding']).toBe('gzip')
  })

  it('does not compress AsyncIteratorObject responses', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(async function* () {
          yield 'yield1'
          yield 'yield2'
        }),
      },
      {
        plugins: [new BodyCompressionHandlerPlugin({ filter: () => true })],
      },
    )

    const res = await request(toRequestListener(handler))
      .post('/ping')
      .set('accept-encoding', 'gzip, deflate')
      .set('content-type', 'application/json')
      .send({ json: null })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.text).toContain('yield1')
    expect(res.text).toContain('yield2')
  })
})
