import { sleep } from '@standardserver/shared'
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface OpenSocket {
  socket: WebSocket
  messages: string[]
}

function toText(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data)
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }

  throw new TypeError(`Unexpected websocket message payload: ${String(data)}`)
}

async function openSocket(stub: DurableObjectStub, lastEventId?: string): Promise<OpenSocket> {
  const headers = new Headers({ upgrade: 'websocket' })
  if (lastEventId !== undefined) {
    headers.set('last-event-id', lastEventId)
  }

  const response = await stub.fetch('https://example.com/subscribe', { headers })

  expect(response.status).toBe(101)
  expect(response.webSocket).toBeDefined()

  const socket = response.webSocket!
  const messages: string[] = []

  socket.addEventListener('message', (event) => {
    messages.push(toText(event.data))
  })

  socket.accept()

  return { socket, messages }
}

async function publish(stub: DurableObjectStub, payload: object | string): Promise<Response> {
  return stub.fetch('https://example.com/publish', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

async function readMessages<T>(socket: OpenSocket, count: number): Promise<T[]> {
  await vi.waitFor(() => {
    expect(socket.messages).toHaveLength(count)
  })

  return socket.messages.map(message => JSON.parse(message) as T)
}

async function getAlarm(stub: DurableObjectStub): Promise<number | null> {
  return runInDurableObject(stub, async (_, state) => state.storage.getAlarm())
}

async function closeSocket(socket: OpenSocket): Promise<void> {
  socket.socket.close(1000, 'done')
  await sleep(0)
}

beforeEach(async () => {
  await reset()
  vi.clearAllMocks()
})

describe('durable publisher object', () => {
  it('sends live messages and does not replay when replay is off', async () => {
    const stub = env.PUBLISHER_DON.getByName(crypto.randomUUID())

    const firstSubscriber = await openSocket(stub)
    const secondSubscriber = await openSocket(stub)

    const payload = {
      data: { text: 'live event' },
      meta: { id: 'client-id' },
    }

    const response = await publish(stub, payload)

    expect(response.status).toBe(204)
    expect((await readMessages(firstSubscriber, 1))[0]).toEqual(payload)
    expect((await readMessages(secondSubscriber, 1))[0]).toEqual(payload)

    await closeSocket(firstSubscriber)
    await closeSocket(secondSubscriber)

    const resumedSubscriber = await openSocket(stub, '0')

    await sleep(100)
    expect(resumedSubscriber.messages).toHaveLength(0)
    await closeSocket(resumedSubscriber)
  })

  it('replays missed messages and gives them new ids', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())

    const liveSubscriber = await openSocket(stub)

    expect((await publish(stub, { data: { text: 'first' } })).status).toBe(204)
    expect((await publish(stub, {
      data: { text: 'second' },
      meta: { id: 'client-id', comments: ['keep me'] },
    })).status).toBe(204)
    expect((await publish(stub, { data: { text: 'third' } })).status).toBe(204)

    const liveMessages = await readMessages(liveSubscriber, 3)

    expect(liveMessages).toEqual([
      { data: { text: 'first' }, meta: { id: '1' } },
      { data: { text: 'second' }, meta: { id: '2', comments: ['keep me'] } },
      { data: { text: 'third' }, meta: { id: '3' } },
    ])

    const replaySubscriber = await openSocket(stub, '2')
    const replayedMessages = await readMessages(replaySubscriber, 1)

    expect(replayedMessages).toEqual([liveMessages[2]])

    const tailSubscriber = await openSocket(stub, '3')

    await sleep(2)
    expect(tailSubscriber.messages).toHaveLength(0)

    await closeSocket(liveSubscriber)
    await closeSocket(replaySubscriber)
    await closeSocket(tailSubscriber)
  })

  it('keeps replay before new live messages', { repeats: 5 }, async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())

    expect((await publish(stub, { data: { order: 1 } })).status).toBe(204)
    expect((await publish(stub, { data: { order: 2 } })).status).toBe(204)

    const [subscriber] = await Promise.all([
      openSocket(stub, '0'),
      Promise.resolve()
        .then(() => publish(stub, { data: { order: 3 } }))
        .then(() => publish(stub, { data: { order: 4 } })),
    ])

    const messages = await readMessages<{ data: { order: number } }>(subscriber, 4)

    expect(messages.map(message => message.data.order)).toEqual([1, 2, 3, 4])

    await closeSocket(subscriber)
  })

  it('drops old replay messages on subscribe', { timeout: 20_000 }, async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())

    expect((await publish(stub, { data: { text: 'event 1' } })).status).toBe(204)
    await evictDurableObject(stub)

    // Not yet expired (< 3s old): subscribing runs cleanup, but nothing is removed.
    await sleep(1_000)
    const subscriber1 = await openSocket(stub, '0')
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(1)
    })

    // Now expired, but the last cleanup ran too recently, so this subscribe
    // is throttled and skips cleanup: the expired row is still there.
    await sleep(2_500)
    const subscriber2 = await openSocket(stub, '0')
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(1)
    })

    // Expired, and enough time has passed since the last cleanup that
    // throttling no longer applies: cleanup runs and removes the row.
    await sleep(1_500) // 3000ms since last cleanup + 1000ms lag
    const subscriber3 = await openSocket(stub, '0')
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(0)
    })

    expect((await publish(stub, { data: { text: 'event 2' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      state.storage.sql.exec('UPDATE "prefix:events" SET stored_at = unixepoch() - 4')
    })

    // with no cleanup history and runs cleanup again, removing the expired row.
    await evictDurableObject(stub)
    const subscriber4 = await openSocket(stub, '0')
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(0)
    })

    await closeSocket(subscriber1)
    await closeSocket(subscriber2)
    await closeSocket(subscriber3)
    await closeSocket(subscriber4)
  })

  it('drops old replay messages on publish', { timeout: 20_000 }, async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())

    expect((await publish(stub, { data: { text: 'event 1' } })).status).toBe(204)
    await evictDurableObject(stub)

    // Not yet expired (< 3s old): publish runs cleanup, but nothing is removed.
    await sleep(1_000)
    expect((await publish(stub, { data: { text: 'event 2' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(2)
    })

    // Now expired, but the last cleanup ran too recently, so this publish
    // is throttled and skips cleanup: the expired row is still there.
    await sleep(2_500)
    expect((await publish(stub, { data: { text: 'event 3' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(3)
    })

    // Expired, and enough time has passed since the last cleanup that
    // throttling no longer applies: cleanup runs and removes the row.
    await sleep(1_500) // 3000ms since last cleanup + 1000ms lag
    expect((await publish(stub, { data: { text: 'event 4' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(2) // event 1, event 2 are dropped
    })

    expect((await publish(stub, { data: { text: 'event 5' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      state.storage.sql.exec('UPDATE "prefix:events" SET stored_at = unixepoch() - 4')
    })

    // with no cleanup history and runs cleanup again, removing the expired row.
    await evictDurableObject(stub)
    expect((await publish(stub, { data: { text: 'event 6' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      const rows = state.storage.sql.exec('SELECT payload FROM "prefix:events"').toArray()
      expect(rows).toHaveLength(1)
    })
  })

  it('still sends when one socket fails', async () => {
    const stub = env.PUBLISHER_DON.getByName(crypto.randomUUID())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const healthySubscriber = await openSocket(stub)

    await runInDurableObject(stub, async (instance) => {
      const ctx = (instance as unknown as { ctx: DurableObjectState }).ctx
      const originalGetWebSockets = ctx.getWebSockets.bind(ctx)

      Object.defineProperty(ctx, 'getWebSockets', {
        configurable: true,
        value: () => [
          { send: () => { throw new Error('forced live send failure') } } as unknown as WebSocket,
          ...originalGetWebSockets(),
        ],
      })
    })

    expect((await publish(stub, { data: { text: 'still delivered' } })).status).toBe(204)
    expect((await readMessages(healthySubscriber, 1))[0]).toEqual({
      data: { text: 'still delivered' },
    })

    await sleep(0)
    expect(consoleError).toHaveBeenCalled()

    await closeSocket(healthySubscriber)
  })

  it('returns 400 for bad replay data and still works after', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const subscriber = await openSocket(stub)

    const invalidResponse = await publish(stub, 'not-json')

    expect(invalidResponse.status).toBe(400)
    expect(await invalidResponse.text()).toBe('Invalid or unprocessable event payload')
    expect(consoleError).toHaveBeenCalledTimes(1)

    expect((await publish(stub, { data: { text: 'after-error' } })).status).toBe(204)
    expect((await readMessages(subscriber, 1))[0]).toEqual({
      data: { text: 'after-error' },
      meta: { id: '1' },
    })

    await closeSocket(subscriber)
  })

  it('reject subscribe request when replay send fails', async ({ onTestFinished }) => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    expect((await publish(stub, { data: { text: 'stored replay' } })).status).toBe(204)

    await runInDurableObject(stub, async () => {
      const globalObject = globalThis as typeof globalThis & {
        __originalWebSocketPair__?: typeof WebSocketPair
        WebSocketPair: typeof WebSocketPair
      }

      const OriginalWebSocketPair = globalObject.WebSocketPair
      globalObject.WebSocketPair = function ThrowingWebSocketPair() {
        const pair = new OriginalWebSocketPair()
        pair[1].send = () => {
          throw new Error('forced replay send failure')
        }

        return pair
      } as unknown as typeof WebSocketPair

      onTestFinished(() => {
        globalObject.WebSocketPair = OriginalWebSocketPair
      })
    })

    await expect(openSocket(stub, '0')).rejects.toThrow('forced replay send failure')
  })

  it('keeps a cleanup alarm that is already far enough out', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    const existingAlarm = Date.now() + 60_000

    await runInDurableObject(stub, async (_, state) => {
      await state.storage.setAlarm(existingAlarm)
    })

    expect((await publish(stub, { data: { text: 'keep existing alarm' } })).status).toBe(204)

    await vi.waitFor(async () => {
      expect(await getAlarm(stub)).toBe(existingAlarm)
    })
  })

  it('moves a cleanup alarm when it would fire too soon', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    const existingAlarm = Date.now() + 1_000

    await runInDurableObject(stub, async (_, state) => {
      await state.storage.setAlarm(existingAlarm)
    })

    expect((await publish(stub, { data: { text: 'reschedule alarm' } })).status).toBe(204)

    await vi.waitFor(async () => {
      expect(await getAlarm(stub)).toBeGreaterThan(existingAlarm + 20_000)
    })
  })

  it('resets replay storage when the id reaches the max value', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await publish(stub, { data: { text: 'initial' } })).status).toBe(204)
    await runInDurableObject(stub, async (_, state) => {
      state.storage.sql.exec(
        'INSERT INTO "prefix:events" (id, payload) VALUES (?, ?)',
        '9223372036854775807',
        JSON.stringify({ data: { text: 'before-overflow' } }),
      )
    })

    expect((await publish(stub, { data: { text: 'recovered' } })).status).toBe(204)
    expect(consoleError).toHaveBeenCalled()

    const replaySubscriber = await openSocket(stub, '0')

    expect((await readMessages(replaySubscriber, 1))[0]).toEqual({
      data: { text: 'recovered' },
      meta: { id: '1' },
    })

    await closeSocket(replaySubscriber)
  })

  it('does not clean up while a socket is still open', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())
    const subscriber = await openSocket(stub, '0')

    await runDurableObjectAlarm(stub)
    expect(await getAlarm(stub)).not.toBeNull()

    expect((await publish(stub, { data: { text: 'after-alarm' } })).status).toBe(204)
    expect((await readMessages(subscriber, 1))[0]).toEqual({
      data: { text: 'after-alarm' },
      meta: { id: '1' },
    })

    await runDurableObjectAlarm(stub)
    expect(await getAlarm(stub)).not.toBeNull()

    await closeSocket(subscriber)
  })

  it('cleans up old replay data after idle time', async () => {
    const stub = env.PUBLISHER_REPLAY3S_DON.getByName(crypto.randomUUID())

    expect((await publish(stub, { data: { text: 'fresh replay event' } })).status).toBe(204)

    await runDurableObjectAlarm(stub)
    expect(await getAlarm(stub)).not.toBeNull()

    const beforeExpirySubscriber = await openSocket(stub, '0')

    expect((await readMessages(beforeExpirySubscriber, 1))[0]).toEqual({
      data: { text: 'fresh replay event' },
      meta: { id: '1' },
    })

    await closeSocket(beforeExpirySubscriber)

    await runInDurableObject(stub, async (_, state) => {
      state.storage.sql.exec('UPDATE "prefix:events" SET stored_at = unixepoch() - 10')
    })
    await evictDurableObject(stub)

    await runDurableObjectAlarm(stub)
    expect(await getAlarm(stub)).toBeNull()

    const afterCleanupSubscriber = await openSocket(stub, '0')

    await sleep(100)
    expect(afterCleanupSubscriber.messages).toHaveLength(0)
    await closeSocket(afterCleanupSubscriber)

    const newLiveSubscriber = await openSocket(stub)

    expect((await publish(stub, { data: { text: 'after cleanup' } })).status).toBe(204)
    expect((await readMessages(newLiveSubscriber, 1))[0]).toEqual({
      data: { text: 'after cleanup' },
      meta: { id: '1' },
    })

    await closeSocket(newLiveSubscriber)
  })
})
