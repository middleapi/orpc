import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { APIGatewayProxyEventV2, AwsLambdaGlobal, HttpResponseStream } from '@standard-server/aws-lambda'
import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { os } from '@orpc/server'
import { z } from 'zod'
import { OpenRPCHandler } from './openrpc-handler'

class TestResponseStream extends Writable implements HttpResponseStream {
  chunks: Buffer[] = []
  metadata: { statusCode: number, headers: Record<string, string>, cookies: string[] } | undefined

  get text(): string {
    return Buffer.concat(this.chunks).toString()
  }

  setContentType(): void {
    // noop
  }

  override _write(chunk: any, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
}

function createEvent(body: unknown, override: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: '/rpc',
    rawQueryString: '',
    headers: {
      'host': 'example.com',
      'content-type': 'application/json',
    },
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    ...override,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubGlobal('awslambda', {
    streamifyResponse: handler => handler,
    HttpResponseStream: {
      from(responseStream, metadata) {
        (responseStream as TestResponseStream).metadata = metadata
        return responseStream
      },
    },
  } satisfies AwsLambdaGlobal)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openRPCHandler', () => {
  const handler = new OpenRPCHandler({
    ping: os
      .$context<{ userId: string }>()
      .handler(({ context }) => `pong ${context.userId}`),
    planet: {
      find: os.input(z.object({ id: z.number() })).handler(({ input }) => ({ id: input.id, name: 'Earth' })),
    },
  })

  const options = { context: { userId: 'u_123' }, prefix: '/rpc' } as const

  it('answers a single call', async () => {
    const stream = new TestResponseStream()
    const result = await handler.handle(createEvent({ jsonrpc: '2.0', method: 'ping', id: 1 }), stream, options)

    expect(result.matched).toBe(true)
    expect(stream.metadata?.statusCode).toBe(200)
    expect(stream.metadata?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(stream.text)).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong u_123' })
  })

  it('answers a batch', async () => {
    const stream = new TestResponseStream()
    await handler.handle(createEvent([
      { jsonrpc: '2.0', method: 'planet.find', params: { id: 1 }, id: 1 },
      { jsonrpc: '2.0', method: 'ping' },
      { foo: 'boo' },
    ]), stream, options)

    expect(stream.metadata?.statusCode).toBe(200)
    expect(JSON.parse(stream.text)).toEqual([
      { jsonrpc: '2.0', id: 1, result: { id: 1, name: 'Earth' } },
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
    ])
  })

  it('answers notifications with 204 and no body', async () => {
    const stream = new TestResponseStream()
    await handler.handle(createEvent({ jsonrpc: '2.0', method: 'ping' }), stream, options)

    expect(stream.metadata?.statusCode).toBe(204)
    expect(stream.text).toBe('')
  })

  it('rejects other content types with 415', async () => {
    const stream = new TestResponseStream()
    await handler.handle(createEvent({ jsonrpc: '2.0', method: 'ping', id: 1 }, {
      headers: { 'host': 'example.com', 'content-type': 'text/plain' },
    }), stream, options)

    expect(stream.metadata?.statusCode).toBe(415)
    expect(JSON.parse(stream.text)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32015 } })
  })

  it('passes requests outside the endpoint through', async () => {
    const stream = new TestResponseStream()
    const result = await handler.handle(createEvent({ jsonrpc: '2.0', method: 'ping', id: 1 }, { rawPath: '/rpc/ping' }), stream, options)

    expect(result.matched).toBe(false)
    expect(stream.metadata).toBeUndefined()
    expect(stream.text).toBe('')
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

    const stream = new TestResponseStream()
    const result = await handler.handle(createEvent(undefined, { requestContext: { http: { method: 'GET' } }, body: undefined }), stream)

    expect(result.matched).toBe(true)
    expect(stream.text).toBe('"intercepted"')
  })
})
