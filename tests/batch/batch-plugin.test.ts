import { ORPCError, os } from '@orpc/server'
import { promiseWithResolvers } from '@orpc/shared'
import { sleep } from '@standard-server/shared'
import { z } from 'zod'
import { createCompressionHonoFetchBatchClientServerTest } from './__shared__/client-server.compression-hono-fetch'
import { createCompressionNodeHttpBatchClientServerTest } from './__shared__/client-server.compression-node-http'
import { createHonoFetchBatchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpBatchClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['node-http', createNodeHttpBatchClientServerTest],
  ['hono-fetch', createHonoFetchBatchClientServerTest],
  ['compression-node-http', createCompressionNodeHttpBatchClientServerTest],
  ['compression-hono-fetch', createCompressionHonoFetchBatchClientServerTest],
])('batch plugin: %s', (_name, createClientServer) => {
  it('keeps successful and failed subrequests isolated within one batch', async () => {
    const success = vi.fn(async (_options: unknown, input: string) => {
      await sleep(20)
      return `ok:${input}`
    })

    const failure = vi.fn(async (_options: unknown, input: string) => {
      await sleep(20)
      throw new ORPCError('BAD_REQUEST', { message: `bad:${input}` })
    })

    const router = {
      success: os.input(z.string()).handler(success),
      failure: os.input(z.string()).handler(failure),
    }

    const { client, fetchSpy } = createClientServer(router)

    const [successResult, failureResult] = await Promise.allSettled([
      client.success('alpha'),
      client.failure('beta'),
    ])

    expect(successResult).toEqual({ status: 'fulfilled', value: 'ok:alpha' })
    expect(failureResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'BAD_REQUEST', message: 'bad:beta' }),
    })
    expect(success).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  /**
   * A buffered batch with no binary subresponse is a plain json array rather than the binary
   * framing every other case here produces, so it travels a different encoding path.
   */
  it('round-trips a buffered batch of json-only responses', async () => {
    const router = {
      echo: os.input(z.string()).handler(({ input }) => `echo:${input}`),
    }

    const { client, fetchSpy } = createClientServer(router, { mode: 'buffered' })

    await Promise.all([
      expect(client.echo('alpha')).resolves.toBe('echo:alpha'),
      expect(client.echo('beta')).resolves.toBe('echo:beta'),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  it('support readable stream, blob, json, and AsyncIteratorObject responses in buffered mode', async () => {
    let isStreamClosed = false
    let isEventsReturned = false

    const streamProcedure = vi.fn(async () => new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('part 1'))
        await sleep(20)
        controller.enqueue(new TextEncoder().encode('part 2'))
        isStreamClosed = true
        controller.close()
      },
    }))

    const blobProcedure = vi.fn(async () => new Blob(['mixed payload'], { type: 'application/octet-stream' }))

    const jsonProcedure = vi.fn(async () => ({ ok: 'buffered-mixed' }))

    const eventProcedure = vi.fn(async function* () {
      yield 'event 1'
      await sleep(20)
      yield { event: 2 }
      isEventsReturned = true
      return 'event 3'
    })

    const router = {
      stream: os.handler(streamProcedure),
      blob: os.handler(blobProcedure),
      json: os.handler(jsonProcedure),
      events: os.handler(eventProcedure),
    }

    const { client, fetchSpy } = createClientServer(router, { mode: 'buffered' })

    const [stream, file, info, iterator] = await Promise.all([
      client.stream(),
      client.blob(),
      client.json(),
      client.events(),
    ])

    // Buffered mode answers only after every subresponse finished, streams included, while a
    // streaming batch would resolve these calls with both streams still open.
    expect(isStreamClosed).toBe(true)
    expect(isEventsReturned).toBe(true)

    const reader = stream.getReader()
    const first = await reader.read()
    const second = await reader.read()
    const third = await reader.read()

    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toBe('part 1')
    expect(second.done).toBe(false)
    expect(new TextDecoder().decode(second.value)).toBe('part 2')
    expect(third).toEqual({ value: undefined, done: true })

    expect(file).toBeInstanceOf(Blob)
    await expect((file as Blob).text()).resolves.toBe('mixed payload')
    expect(info).toEqual({ ok: 'buffered-mixed' })

    await expect(iterator.next()).resolves.toEqual({ value: 'event 1', done: false })
    await expect(iterator.next()).resolves.toEqual({ value: { event: 2 }, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 'event 3', done: true })

    expect(streamProcedure).toHaveBeenCalledTimes(1)
    expect(blobProcedure).toHaveBeenCalledTimes(1)
    expect(jsonProcedure).toHaveBeenCalledTimes(1)
    expect(eventProcedure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  it('supports readable stream, blob, json, and AsyncIteratorObject responses in streaming mode', async () => {
    const part2 = promiseWithResolvers<void>()
    const event2 = promiseWithResolvers<void>()

    const streamProcedure = vi.fn(async () => new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('part 1'))
        await part2.promise
        controller.enqueue(new TextEncoder().encode('part 2'))
        controller.close()
      },
    }))

    const blobProcedure = vi.fn(async () => new Blob(['streaming mixed payload'], { type: 'application/octet-stream' }))

    const jsonProcedure = vi.fn(async () => ({ ok: 'streaming-mixed' }))

    const eventProcedure = vi.fn(async function* () {
      yield 'event 1'
      await event2.promise
      yield { event: 2 }
      return 'event 3'
    })

    const router = {
      stream: os.handler(streamProcedure),
      blob: os.handler(blobProcedure),
      json: os.handler(jsonProcedure),
      events: os.handler(eventProcedure),
    }

    const { client, fetchSpy } = createClientServer(router, { mode: 'streaming' })

    // Both streams hold everything after their first item until the test releases it, so a batch
    // that waited for every subresponse to finish would hang here instead of resolving.
    const [stream, file, info, iterator] = await Promise.all([
      client.stream() as Promise<ReadableStream<Uint8Array>>,
      client.blob(),
      client.json(),
      client.events() as Promise<AsyncIteratorObject<unknown>>,
    ])

    expect(file).toBeInstanceOf(Blob)
    await expect((file as Blob).text()).resolves.toBe('streaming mixed payload')
    expect(info).toEqual({ ok: 'streaming-mixed' })

    const reader = stream.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toBe('part 1')

    await expect(iterator.next()).resolves.toEqual({ value: 'event 1', done: false })

    part2.resolve()
    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(new TextDecoder().decode(second.value)).toBe('part 2')

    event2.resolve()
    await expect(iterator.next()).resolves.toEqual({ value: { event: 2 }, done: false })

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    await expect(iterator.next()).resolves.toEqual({ value: 'event 3', done: true })

    expect(streamProcedure).toHaveBeenCalledTimes(1)
    expect(blobProcedure).toHaveBeenCalledTimes(1)
    expect(jsonProcedure).toHaveBeenCalledTimes(1)
    expect(eventProcedure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })
})

describe('batch plugin: QUERY over node-http', () => {
  it('round-trips concurrent calls through one outer QUERY request', async () => {
    const router = {
      echo: os.input(z.string()).handler(({ input }) => `echo:${input}`),
    }

    const { client, fetchSpy } = createNodeHttpBatchClientServerTest(router, { method: 'QUERY' })

    await Promise.all([
      expect(client.echo('alpha')).resolves.toBe('echo:alpha'),
      expect(client.echo('beta')).resolves.toBe('echo:beta'),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ method: 'QUERY' }))
  })
})
