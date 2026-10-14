import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'

const KiB = 1024
const MiB = 1024 * KiB

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function setup(plugin = new BatchHandlerPlugin()) {
  const state = { pulledBytes: 0, finalized: 0 }

  const handler = new RPCHandler({
    export: os.handler(async function* () { // 128 x 32 KiB = 4 MiB per call
      try {
        for (let i = 0; i < 128; i++) {
          state.pulledBytes += 32 * KiB
          yield 'x'.repeat(32 * KiB)
        }
      }
      finally {
        state.finalized++
      }
    }),
    live: os.handler(async function* () { // endless subscription
      try {
        while (true) {
          state.pulledBytes += 4 * KiB
          yield 'y'.repeat(4 * KiB)
          await sleep(0)
        }
      }
      finally {
        state.finalized++
      }
    }),
  }, {
    plugins: [plugin],
    routingInterceptors: [
      async ({ next, request }) => { // like StaticFileHandlerPlugin: a pull-based 4 MiB stream
        const result = await next()
        if (result.matched || !request.url.endsWith('/file')) {
          return result
        }
        let sent = 0
        return {
          matched: true,
          response: {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
            body: new ReadableStream<Uint8Array<ArrayBuffer>>({
              pull(controller) {
                if (sent === 64) {
                  controller.close()
                  return
                }
                sent++
                state.pulledBytes += 64 * KiB
                controller.enqueue(new Uint8Array(64 * KiB))
              },
            }),
          },
        }
      },
    ],
  })

  return { handler, state }
}

function batch(mode: 'streaming' | 'buffered', url: string, { count = 10, signal }: { count?: number, signal?: AbortSignal } = {}) {
  return new Request('https://example.com/__batch__', {
    method: 'POST',
    headers: { 'orpc-batch': mode, 'content-type': 'application/json' },
    body: JSON.stringify(Array.from({ length: count }, (_, id) => ({
      kind: 'request',
      id: String(id),
      json: { url, method: 'POST', headers: {} },
    }))),
    signal,
  })
}

describe('batchHandlerPlugin backpressure and buffering limits', () => {
  it.each(['/export', '/file'])('streaming mode does not drain %s sub-responses while the response is unread', async (url) => {
    const { handler, state } = setup()
    const { response } = await handler.handle(batch('streaming', url))
    expect(response!.status).toBe(207)

    await sleep(300) // the client never reads a byte

    try {
      expect(state.pulledBytes).toBeLessThanOrEqual(4 * MiB) // today: all 40 MiB
    }
    finally {
      await response!.body!.cancel()
    }
  })

  it.each(['/export', '/file'])('streaming mode still delivers every %s byte when the response is read', async (url) => {
    const { handler, state } = setup()
    const { response } = await handler.handle(batch('streaming', url))
    const body = await response!.arrayBuffer()

    expect(state.pulledBytes).toBe(10 * 4 * MiB)
    expect(body.byteLength).toBeGreaterThan(10 * 4 * MiB)
  })

  it('streaming mode releases blocked sub-streams when the response body is cancelled', async () => {
    const { handler, state } = setup()
    const { response } = await handler.handle(batch('streaming', '/export'))

    await sleep(100)
    await response!.body!.cancel()

    await vi.waitFor(() => expect(state.finalized).toBe(10))
  })

  it('streaming mode releases blocked sub-streams when the batch request is aborted', async () => {
    const { handler, state } = setup()
    const controller = new AbortController()
    const { response } = await handler.handle(batch('streaming', '/export', { signal: controller.signal }))

    await sleep(100)
    controller.abort()

    await vi.waitFor(() => expect(state.finalized).toBe(10))
    await response!.arrayBuffer().catch(() => {}) // must end instead of hanging
  })

  it('buffered mode rejects a batch whose streamed output exceeds the default cap', async () => {
    const { handler, state } = setup()
    const { response } = await handler.handle(batch('buffered', '/file')) // 10 x 4 MiB

    expect(response!.status).toBeGreaterThanOrEqual(400) // today: 207 with 40 MiB buffered
    expect(state.pulledBytes).toBeLessThanOrEqual(16 * MiB)
  })

  it('buffered mode stops an endless stream instead of buffering it forever', async () => {
    const { handler, state } = setup(new BatchHandlerPlugin({ maxBufferedResponseSize: 1 * MiB }))
    const controller = new AbortController()
    const pending = handler.handle(batch('buffered', '/live', { signal: controller.signal }))

    try {
      const result = await Promise.race([pending, sleep(2000).then(() => undefined)])

      expect(result, `still pending after 2s with ${state.pulledBytes} bytes buffered`).toBeDefined()
      expect(result!.response!.status).toBeGreaterThanOrEqual(400)
      await vi.waitFor(() => expect(state.finalized).toBe(10))
    }
    finally {
      controller.abort()
      await pending.catch(() => {})
    }
  })
})
