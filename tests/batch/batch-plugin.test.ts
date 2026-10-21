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
   * Without a stream subresponse, a batch is the binary framing collected into a blob
   * once every subresponse is ready, rather than a stream.
   */
  it('round-trips a batch of blob and json responses', async () => {
    const router = {
      blob: os.handler(() => new Blob(['blob payload'], { type: 'application/octet-stream' })),
      json: os.handler(() => ({ ok: 'mixed' })),
    }

    const { client, fetchSpy } = createClientServer(router)

    const [file, info] = await Promise.all([
      client.blob(),
      client.json(),
    ])

    expect(file).toBeInstanceOf(Blob)
    await expect((file as Blob).text()).resolves.toBe('blob payload')
    expect(info).toEqual({ ok: 'mixed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  /**
   * A stream may never end, so a batch streams once every subresponse is ready and one of them is a stream.
   */
  it('supports readable stream, blob, json, and AsyncIteratorObject responses', async () => {
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

    const blobProcedure = vi.fn(async () => new Blob(['blob payload'], { type: 'application/octet-stream' }))

    const jsonProcedure = vi.fn(async () => ({ ok: 'mixed' }))

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

    const { client, fetchSpy } = createClientServer(router)

    // Both streams hold everything after their first item until the test releases it, so a batch
    // that waited for every subresponse to finish would hang here instead of resolving.
    const [stream, file, info, iterator] = await Promise.all([
      client.stream() as Promise<ReadableStream<Uint8Array>>,
      client.blob(),
      client.json(),
      client.events() as Promise<AsyncIteratorObject<unknown>>,
    ])

    expect(file).toBeInstanceOf(Blob)
    await expect((file as Blob).text()).resolves.toBe('blob payload')
    expect(info).toEqual({ ok: 'mixed' })

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

  it('sends file uploads outside the batch', async () => {
    const router = {
      upload: os.input(z.object({ file: z.file() })).handler(({ input }) => input.file.text()),
      echo: os.input(z.string()).handler(({ input }) => `echo:${input}`),
    }

    const { client, fetchSpy } = createClientServer(router, { method: 'POST' })

    await Promise.all([
      expect(client.upload({ file: new File(['hello'], 'a.txt') })).resolves.toBe('hello'),
      expect(client.echo('alpha')).resolves.toBe('echo:alpha'),
      expect(client.echo('beta')).resolves.toBe('echo:beta'),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(2) // the upload plus one batch for both echoes
  })

  it('stops a cancelled stream once every other subrequest in the batch has finished', async () => {
    const release = promiseWithResolvers<void>()
    const stopped = promiseWithResolvers<void>()

    const router = {
      json: os.handler(() => 'ok'),
      blob: os.handler(() => new Blob(['blob'])),
      stream: os.handler(() => new ReadableStream<Uint8Array>({
        async start(controller) {
          await release.promise
          controller.enqueue(new TextEncoder().encode('stream'))
          controller.close()
        },
      })),
      events: os.handler(async function* () {
        await release.promise
        yield 'event'
      }),
      endless: os.handler(async function* () {
        try {
          for (let i = 0; ; i++) {
            yield i
            await sleep(10)
          }
        }
        finally {
          stopped.resolve()
        }
      }),
    }

    const { client, fetchSpy } = createClientServer(router)

    const [info, file, stream, events, endless] = await Promise.all([
      client.json(),
      client.blob(),
      client.stream() as Promise<ReadableStream<Uint8Array>>,
      client.events() as Promise<AsyncIteratorObject<unknown>>,
      client.endless() as Promise<AsyncIteratorObject<unknown>>,
    ])

    expect(info).toBe('ok')
    await expect((file as Blob).text()).resolves.toBe('blob')
    await expect(endless.next()).resolves.toEqual({ value: 0, done: false })
    await endless.return?.()

    // The still open streams keep the batch alive, then only the cancelled one is left running.
    release.resolve()
    await expect(new Response(stream).text()).resolves.toBe('stream')
    await expect(events.next()).resolves.toEqual({ value: 'event', done: false })
    await expect(events.next()).resolves.toEqual({ value: undefined, done: true })

    await stopped.promise
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
