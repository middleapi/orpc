import type { AwsLambdaGlobal, HttpResponseStream } from '@standard-server/aws-lambda'
import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { os } from '@orpc/server'
import { OpenRPCHandler } from './openrpc-handler'

class TestResponseStream extends Writable implements HttpResponseStream {
  chunks: Buffer[] = []
  metadata: { statusCode: number } | undefined

  setContentType(): void {}

  override _write(chunk: any, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
}

it('openRPCHandler serves JSON-RPC on AWS Lambda', async () => {
  vi.stubGlobal('awslambda', {
    streamifyResponse: handler => handler,
    HttpResponseStream: {
      from(responseStream, metadata) {
        (responseStream as TestResponseStream).metadata = metadata
        return responseStream
      },
    },
  } satisfies AwsLambdaGlobal)

  try {
    const handler = new OpenRPCHandler({ ping: os.handler(() => 'pong') })
    const stream = new TestResponseStream()

    const { matched } = await handler.handle({
      rawPath: '/rpc',
      rawQueryString: '',
      headers: { 'host': 'example.com', 'content-type': 'application/json' },
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      isBase64Encoded: false,
    } as any, stream, { prefix: '/rpc' })

    expect(matched).toBe(true)
    expect(stream.metadata?.statusCode).toBe(200)
    expect(JSON.parse(Buffer.concat(stream.chunks).toString())).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' })
  }
  finally {
    vi.unstubAllGlobals()
  }
})
