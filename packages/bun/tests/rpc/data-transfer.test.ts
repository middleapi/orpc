import { os } from '@orpc/server'
import { sleep } from 'bun'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { builtInRPCSupportDataTypes } from './__shared__/built-in-support-data-types'
import { Person } from './__shared__/client-server'
import { createBunFetchClientServerTest } from './__shared__/client-server.bun-fetch'
import { createBunWebSocketClientServerTest } from './__shared__/client-server.bun-websocket'

describe.each([
  ['bun-fetch', createBunFetchClientServerTest],
  ['bun-websocket', createBunWebSocketClientServerTest],
] as const)('data transfer: %s', async (adapter, createClientServer) => {
  const router = {
    ping: os.input(z.any()).handler((_, input) => input),
    lastEventId: os.input(z.any()).handler(({ lastEventId }) => lastEventId),
  }
  const client = createClientServer(router)

  it.each(builtInRPCSupportDataTypes)('should support $name', async ({ value, expected }) => {
    const actual = await client.ping(value)

    if (typeof expected === 'function') {
      expect(expected(actual)).toBe(true)
    }
    else {
      expect(actual).toEqual(expected)
    }
  })

  it('support custom serializer', async () => {
    const person = new Person('Alice', 30)

    await expect(client.ping(person)).resolves.toEqual(person)
  })

  it('support lastEventId', () => {
    const lastEventId = '__TEST_123456789__'

    return expect(client.lastEventId(null, { lastEventId })).resolves.toEqual(lastEventId)
  })

  // TODO: There an issues with Bun Websocket Server, when multiple messages sent simultaneously
  // We might need to report this issue
  it.skipIf(adapter === 'bun-websocket')('support octet stream and transfer octet in parallel', async () => {
    const stream = new ReadableStream<string>({
      async start(controller) {
        controller.enqueue('order 1')
        await sleep(200)
        controller.enqueue('order 2')
        await sleep(200)
        controller.enqueue('order 3')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    let startTime = Date.now()
    const result = await client.ping(stream) as ReadableStream<Uint8Array>
    expect(Date.now() - startTime).toBeLessThan(100)

    const reader = result.getReader()

    startTime = Date.now()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(first.value)).toBe('order 1')
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(second.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(second.value)).toBe('order 2')
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    const third = await reader.read()
    expect(third.done).toBe(false)
    expect(third.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(third.value)).toBe('order 3')
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(Date.now() - startTime).toBeLessThan(100)
  })

  // TODO: There an issues with Bun Websocket Server, when multiple messages sent simultaneously
  // We might need to report this issue
  it.skipIf(adapter === 'bun-websocket')('support event iterator and transfer event iterator in parallel', async () => {
    const stream = (async function* () {
      yield 'order 1'
      await sleep(200)
      yield { order: 2 }
      await sleep(200)
      yield new Person('Order 3', 3)
      await sleep(200)
      return new Date('2024-01-01')
    }())

    let startTime = Date.now()
    const result = await client.ping(stream) as AsyncIteratorObject<unknown>
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: 'order 1', done: false })
    expect(Date.now() - startTime).toBeLessThan(50)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: { order: 2 }, done: false })
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: new Person('Order 3', 3), done: false })
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: new Date('2024-01-01'), done: true })
    expect(Date.now() - startTime).toBeLessThan(250)
  })
})
