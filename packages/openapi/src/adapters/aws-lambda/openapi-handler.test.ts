import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { APIGatewayProxyEventV2, AwsLambdaGlobal, HttpResponseStream } from '@standard-server/aws-lambda'
import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { os } from '@orpc/server'
import { openapi } from '../../meta'
import { OpenAPIHandler } from './openapi-handler'

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

function createEvent(override: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: '/ping/pong',
    rawQueryString: '',
    headers: {
      'host': 'example.com',
      'content-type': 'application/json',
    },
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({ json: null }),
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

describe('openapiHandler', () => {
  it('accepts context and prefix options in handle method', async () => {
    const handler = new OpenAPIHandler({
      ping: os
        .$context<{ userId: string }>()
        .meta(openapi({ method: 'POST', path: '/ping/pong' }))
        .handler(({ context }) => context.userId),
    })

    const responseStream = new TestResponseStream()
    const result = await handler.handle(createEvent({ rawPath: '/api/v1/ping/pong' }), responseStream, {
      context: { userId: 'u_123' },
      prefix: '/api/v1',
    })

    expect(result.matched).toBe(true)
    expect(responseStream.metadata?.statusCode).toBe(200)
    expect(responseStream.text).toContain('u_123')

    const mismatchStream = new TestResponseStream()
    const mismatchResult = await handler.handle(createEvent({ rawPath: '/invalid/ping' }), mismatchStream, {
      context: { userId: 'u_123' },
      prefix: '/api/v1',
    })

    expect(mismatchResult.matched).toBe(false)
    expect(mismatchStream.metadata).toBeUndefined()
    expect(mismatchStream.text).toBe('')
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

    const responseStream = new TestResponseStream()
    const result = await handler.handle(createEvent({ requestContext: { http: { method: 'GET' } }, body: undefined }), responseStream)

    expect(result.matched).toBe(true)
    expect(responseStream.text).toBe('"intercepted"')
  })
})

describe('openapiHandler path decoding', () => {
  const HTTP_API = 'abc123.execute-api.us-east-1.amazonaws.com'
  const FUNCTION_URL = 'abc123xyz.lambda-url.us-east-1.on.aws'

  const handler = new OpenAPIHandler({
    get: os.meta(openapi({ method: 'GET', path: '/users/{id}' })).handler(({ input }) => input),
  })

  it.each([
    ['/users/a%2Fb', HTTP_API, 'a%2Fb'],
    ['/users/%41', HTTP_API, '%41'],
    ['/users/100%', HTTP_API, '100%'],
    ['/users/a b', HTTP_API, 'a b'],
    ['/users/é\\', HTTP_API, 'é\\'],
    ['/users/a%2Fb', FUNCTION_URL, 'a/b'], // encoded, decoded once
  ])('%s from %s yields id %s', async (rawPath, domainName, id) => {
    const responseStream = new TestResponseStream()
    await handler.handle(createEvent({
      rawPath,
      body: null,
      requestContext: { http: { method: 'GET' }, domainName } as APIGatewayProxyEventV2['requestContext'],
    }), responseStream)

    expect(JSON.parse(responseStream.text)).toEqual({ id })
  })
})
