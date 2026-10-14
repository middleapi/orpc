import type { AddressInfo } from 'node:net'
import http2 from 'node:http2'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

describe('rpcHandler on node:http2: client resets', () => {
  const handler = new RPCHandler({
    slow: os.handler(async () => {
      await new Promise(r => setTimeout(r, 100))
      return 'pong'
    }),
    stream: os.handler(async function* () {
      for (let i = 0; i < 1000; i++) {
        yield i
        await new Promise(r => setTimeout(r, 5))
      }
    }),
  })

  async function serveOnce(path: string, abort: (client: http2.ClientHttp2Session, stream: http2.ClientHttp2Stream) => void, afterFirstChunk = false) {
    let dispatched!: (value: { promise: Promise<unknown> }) => void
    const handled = new Promise<{ promise: Promise<unknown> }>(r => (dispatched = r))
    const server = http2.createServer((req, res) => {
      const promise = handler.handle(req, res)
      promise.catch(() => {}) // asserted below; keeps the rejection from leaking
      dispatched({ promise })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    client.on('error', () => {})
    const stream = client.request({ ':method': 'POST', ':path': path, 'content-type': 'application/json' })
    stream.on('error', () => {})
    const firstChunk = new Promise(r => stream.once('data', r))
    stream.on('data', () => {})
    stream.end('{"json":null}')
    try {
      const { promise } = await handled // handle() is in flight
      if (afterFirstChunk)
        await firstChunk
      abort(client, stream)
      return await promise
    }
    finally {
      client.destroy()
      server.close()
    }
  }

  it.each([
    ['REFUSED_STREAM', http2.constants.NGHTTP2_REFUSED_STREAM],
    ['INTERNAL_ERROR', http2.constants.NGHTTP2_INTERNAL_ERROR],
    ['CANCEL', http2.constants.NGHTTP2_CANCEL],
  ])('resolves when the client resets the stream (%s) before the response', async (_, code) => {
    await expect(serveOnce('/slow', (_c, s) => s.close(code))).resolves.toMatchObject({ matched: true })
  })

  it('resolves when the client resets the stream during an event stream', async () => {
    await expect(serveOnce('/stream', (_c, s) => s.close(http2.constants.NGHTTP2_PROTOCOL_ERROR), true)).resolves.toMatchObject({ matched: true })
  })

  it('resolves when the client sends GOAWAY with an error code', async () => {
    await expect(serveOnce('/slow', c => c.goaway(http2.constants.NGHTTP2_PROTOCOL_ERROR))).resolves.toMatchObject({ matched: true })
  })
})
