import { ORPCError, os } from '@orpc/server'
import { sleep } from '@standardserver/shared'
import { z } from 'zod'
import { createHonoFetchBatchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpBatchClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['node-http', createNodeHttpBatchClientServerTest],
  ['hono-fetch', createHonoFetchBatchClientServerTest],
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

  it('support readable stream, blob, json, and event iterator responses in buffered mode', async () => {
    const streamProcedure = vi.fn(async () => new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('part 1'))
        await sleep(20)
        controller.enqueue(new TextEncoder().encode('part 2'))
        controller.close()
      },
    }))

    const blobProcedure = vi.fn(async () => new Blob(['mixed payload'], { type: 'application/octet-stream' }))

    const jsonProcedure = vi.fn(async () => {
      await sleep(20)
      return { ok: 'buffered-mixed' }
    })

    const eventProcedure = vi.fn(async function* () {
      yield 'event 1'
      await sleep(20)
      yield { event: 2 }
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

    const start = Date.now()

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

    expect(Date.now() - start).toBeLessThanOrEqual(10) // ensure all responses were available immediately after the batch resolved
    expect(streamProcedure).toHaveBeenCalledTimes(1)
    expect(blobProcedure).toHaveBeenCalledTimes(1)
    expect(jsonProcedure).toHaveBeenCalledTimes(1)
    expect(eventProcedure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  it('supports readable stream, blob, json, and event iterator responses in streaming mode', async () => {
    const streamProcedure = vi.fn(async () => new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('part 1'))
        await sleep(200)
        controller.enqueue(new TextEncoder().encode('part 2'))
        controller.close()
      },
    }))

    const blobProcedure = vi.fn(async () => new Blob(['streaming mixed payload'], { type: 'application/octet-stream' }))

    const jsonProcedure = vi.fn(async () => ({ ok: 'streaming-mixed' }))

    const eventProcedure = vi.fn(async function* () {
      yield 'event 1'
      await sleep(200)
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

    let startTime = Date.now()
    const [stream, file, info, iterator] = await Promise.all([
      client.stream() as Promise<ReadableStream<Uint8Array>>,
      client.blob(),
      client.json(),
      client.events() as Promise<AsyncIteratorObject<unknown>>,
    ])

    expect(Date.now() - startTime).toBeLessThan(100)
    expect(file).toBeInstanceOf(Blob)
    await expect((file as Blob).text()).resolves.toBe('streaming mixed payload')
    expect(info).toEqual({ ok: 'streaming-mixed' })

    const reader = stream.getReader()

    startTime = Date.now()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toBe('part 1')
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    await expect(iterator.next()).resolves.toEqual({ value: 'event 1', done: false })
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(new TextDecoder().decode(second.value)).toBe('part 2')
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(iterator.next()).resolves.toEqual({ value: { event: 2 }, done: false })
    expect(Date.now() - startTime).toBeLessThan(250)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    await expect(iterator.next()).resolves.toEqual({ value: 'event 3', done: true })

    expect(streamProcedure).toHaveBeenCalledTimes(1)
    expect(blobProcedure).toHaveBeenCalledTimes(1)
    expect(jsonProcedure).toHaveBeenCalledTimes(1)
    expect(eventProcedure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })
})
