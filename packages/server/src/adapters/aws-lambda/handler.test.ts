import type { AnyAPIGatewayProxyEvent, APIGatewayProxyEvent, APIGatewayProxyEventV2, AwsLambdaGlobal, HttpResponseStream } from '@standard-server/aws-lambda'
import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

class TestResponseStream extends Writable implements HttpResponseStream {
  chunks: Buffer[] = []
  setContentType(): void {
    // noop
  }

  override _write(chunk: any, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
}

const headers = { 'host': 'example.com', 'content-type': 'application/json' }
const body = JSON.stringify({ json: null })

// 2.0: HTTP APIs (any domain but a Function URL's) deliver rawPath decoded, Function URLs still encoded
function v2Event(rawPath: string, domainName?: string): APIGatewayProxyEventV2 {
  return { rawPath, rawQueryString: '', headers, requestContext: { http: { method: 'POST' }, domainName }, body, isBase64Encoded: false } as APIGatewayProxyEventV2
}

// 1.0: HTTP APIs set `version: '1.0'` and deliver `path` decoded, REST APIs/ALB omit `version` and keep it encoded
function v1Event(path: string, version?: '1.0'): APIGatewayProxyEvent {
  return { ...(version && { version }), httpMethod: 'POST', path, headers, body, isBase64Encoded: false } as APIGatewayProxyEvent
}

const HTTP_API = 'abc123.execute-api.us-east-1.amazonaws.com'
const FUNCTION_URL = 'abc123xyz.lambda-url.us-east-1.on.aws'

beforeEach(() => {
  vi.stubGlobal('awslambda', {
    streamifyResponse: handler => handler,
    HttpResponseStream: { from: responseStream => responseStream },
  } satisfies AwsLambdaGlobal)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function call(event: AnyAPIGatewayProxyEvent, options: ConstructorParameters<typeof RPCHandler>[1] = {}) {
  const deleteUser = vi.fn(() => 'deleted')
  const handler = new RPCHandler({ admin: { deleteUser: os.handler(deleteUser) } }, options)
  const result = await handler.handle(event, new TestResponseStream(), { prefix: '/rpc' })
  return { matched: result.matched, called: deleteUser.mock.calls.length > 0 }
}

describe('awsLambdaHandler path decoding', () => {
  // the event carries the literal text "%61dmin", which must not become "admin"
  it.each([
    ['HTTP API 2.0', v2Event('/rpc/%61dmin/deleteUser', HTTP_API)],
    ['HTTP API 2.0 custom domain', v2Event('/rpc/%61dmin/deleteUser', 'api.example.com')],
    ['HTTP API 2.0 custom domain posing as a Function URL', v2Event('/rpc/%61dmin/deleteUser', `${FUNCTION_URL}.example.com`)],
    ['2.0 without domainName', v2Event('/rpc/%61dmin/deleteUser')],
    ['HTTP API 1.0', v1Event('/rpc/%61dmin/deleteUser', '1.0')],
  ])('%s: does not decode an already-decoded path again', async (_, event) => {
    expect(await call(event)).toEqual({ matched: false, called: false })
  })

  it.each([
    ['HTTP API 2.0 plain path', v2Event('/rpc/admin/deleteUser', HTTP_API)],
    ['HTTP API 1.0 plain path', v1Event('/rpc/admin/deleteUser', '1.0')],
    ['Function URL (encoded)', v2Event('/rpc/%61dmin/deleteUser', FUNCTION_URL)],
    ['REST API 1.0 (encoded)', v1Event('/rpc/%61dmin/deleteUser')],
  ])('%s: still matches', async (_, event) => {
    expect(await call(event)).toEqual({ matched: true, called: true })
  })

  describe('pathEncoding option', () => {
    it('encoded: decodes every path once', async () => {
      expect(await call(v2Event('/rpc/%61dmin/deleteUser', HTTP_API), { pathEncoding: 'encoded' }))
        .toEqual({ matched: true, called: true })
      expect(await call(v1Event('/rpc/%61dmin/deleteUser', '1.0'), { pathEncoding: 'encoded' }))
        .toEqual({ matched: true, called: true })
    })

    it('decoded: never decodes a path again', async () => {
      expect(await call(v2Event('/rpc/%61dmin/deleteUser', FUNCTION_URL), { pathEncoding: 'decoded' }))
        .toEqual({ matched: false, called: false })
      expect(await call(v1Event('/rpc/%61dmin/deleteUser'), { pathEncoding: 'decoded' }))
        .toEqual({ matched: false, called: false })
      expect(await call(v2Event('/rpc/admin/deleteUser', FUNCTION_URL), { pathEncoding: 'decoded' }))
        .toEqual({ matched: true, called: true })
    })

    it('auto: is the default', async () => {
      expect(await call(v2Event('/rpc/%61dmin/deleteUser', HTTP_API), { pathEncoding: 'auto' }))
        .toEqual({ matched: false, called: false })
      expect(await call(v2Event('/rpc/%61dmin/deleteUser', FUNCTION_URL), { pathEncoding: 'auto' }))
        .toEqual({ matched: true, called: true })
    })
  })
})
