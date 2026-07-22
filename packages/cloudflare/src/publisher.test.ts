import { RPCSerializer } from '@orpc/client'
import { getEventMeta, withEventMeta } from '@standardserver/core'
import { sleep } from '@standardserver/shared'
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DurablePublisher } from './publisher'

type MockSocket = WebSocket & EventTarget & {
  accepted: boolean
  closeCalls: Array<{ code: number | undefined, reason: string | undefined }>
  sendMessage: (data: string) => void
  sendClose: (code: number, reason?: string) => void
  sendError: () => void
}

function makeSocket(): MockSocket {
  const socket = new EventTarget() as MockSocket

  socket.accepted = false
  socket.closeCalls = []
  socket.accept = () => {
    socket.accepted = true
  }
  socket.close = (code?: number, reason?: string) => {
    socket.closeCalls.push({ code, reason })
  }
  socket.sendMessage = (data: string) => {
    socket.dispatchEvent(new MessageEvent('message', { data }))
  }
  socket.sendClose = (code: number, reason = '') => {
    socket.dispatchEvent(new CloseEvent('close', { code, reason }))
  }
  socket.sendError = () => {
    socket.dispatchEvent(new Event('error'))
  }

  return socket
}

beforeEach(async () => {
  await reset()
  vi.clearAllMocks()
})

describe('durable publisher', () => {
  it('sends live messages without resume', async () => {
    const publisher = new DurablePublisher(env.PUBLISHER_DON)

    const live = vi.fn()
    const stopLive = await publisher.subscribe('message', live)

    await publisher.publish('notice', { text: 'ignore me' })
    await publisher.publish('message', { text: 'first' })
    await publisher.publish('message', withEventMeta({ text: 'second' }, {
      id: 'client-id',
      comments: ['keep me'],
    }))

    await vi.waitFor(() => {
      expect(live).toHaveBeenCalledTimes(2)
    })

    const first = live.mock.calls[0]![0]
    const second = live.mock.calls[1]![0]

    expect(first).toEqual({ text: 'first' })
    expect(getEventMeta(first)?.id).toBeUndefined()

    expect(second).toEqual({ text: 'second' })
    expect(getEventMeta(second)?.id).toBe('client-id')
    expect(getEventMeta(second)?.comments).toEqual(['keep me'])

    await stopLive()

    const resume = vi.fn()
    const stopResume = await publisher.subscribe('message', resume, {
      lastEventId: '0',
    })

    await sleep(100)
    expect(resume).toHaveBeenCalledTimes(0)

    await stopResume()
  })

  it('sends live messages and resumes missed ones', async () => {
    const publisher = new DurablePublisher(env.PUBLISHER_RESUME3S_DON)

    const live = vi.fn()
    const stopLive = await publisher.subscribe('message', live)

    await publisher.publish('notice', { text: 'ignore me' })
    await publisher.publish('message', { text: 'first' })
    await publisher.publish('message', withEventMeta({ text: 'second' }, {
      id: 'client-id',
      comments: ['keep me'],
    }))

    await vi.waitFor(() => {
      expect(live).toHaveBeenCalledTimes(2)
    })

    const first = live.mock.calls[0]![0]
    const second = live.mock.calls[1]![0]

    expect(first).toEqual({ text: 'first' })
    expect(getEventMeta(first)?.id).toBe('1')

    expect(second).toEqual({ text: 'second' })
    expect(getEventMeta(second)?.id).toBe('2')
    expect(getEventMeta(second)?.comments).toEqual(['keep me'])

    await stopLive()

    const resume = vi.fn()
    const stopResume = await publisher.subscribe('message', resume, {
      lastEventId: getEventMeta(first)?.id,
    })

    await vi.waitFor(() => {
      expect(resume).toHaveBeenCalledTimes(1)
    })

    expect(resume).toHaveBeenCalledWith(second)

    await stopResume()
  })

  it('resumes old messages before new ones', { repeats: 5 }, async () => {
    const publisher = new DurablePublisher(env.PUBLISHER_RESUME3S_DON)

    await publisher.publish('timeline', { order: 1 })
    await publisher.publish('timeline', { order: 2 })

    const listener = vi.fn()
    const [unsubscribe] = await Promise.all([
      publisher.subscribe('timeline', listener, { lastEventId: '0' }),
      Promise.resolve()
        .then(() => publisher.publish('timeline', { order: 3 }))
        .then(() => publisher.publish('timeline', { order: 4 })),
    ])

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(4)
    })

    expect(listener.mock.calls.map(call => call[0].order)).toEqual([1, 2, 3, 4])

    await unsubscribe()
  })

  it('uses the custom serializer and prefix', async () => {
    class Person {
      constructor(
        public name: string,
        public age: number,
      ) {}
    }

    const serializer = new RPCSerializer({
      handlers: {
        person: {
          condition: p => p instanceof Person,
          serialize: (p: Person) => ({ name: p.name, age: p.age }),
          deserialize: data => new Person(data.name, data.age),
        },
      },
    })

    const getStubByName = vi.fn((namespace, event) => namespace.getByName(event))
    const publisher = new DurablePublisher<any>(env.PUBLISHER_DON, {
      prefix: 'prefix:',
      serializer: serializer as any,
      getStubByName,
    })

    const listener = vi.fn()
    const unsubscribe = await publisher.subscribe('message', listener)

    const person = new Person('dinwwwh', 99)
    await publisher.publish('message', person)

    expect(getStubByName).toHaveBeenCalledTimes(2)
    expect(getStubByName).toHaveBeenNthCalledWith(1, env.PUBLISHER_DON, `prefix:message`)
    expect(getStubByName).toHaveBeenNthCalledWith(2, env.PUBLISHER_DON, `prefix:message`)

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1)
    })
    expect(listener).toHaveBeenCalledWith(person)

    await unsubscribe()
  })

  it('throws when publish fails', async () => {
    const stub = {
      fetch: vi.fn(async () => new Response('busy', {
        status: 503,
        statusText: 'Service Unavailable',
      })),
    } as unknown as DurableObjectStub

    const namespace = {
      getByName: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace

    const publisher = new DurablePublisher<any>(namespace)

    await expect(publisher.publish('message', { text: 'hello' })).rejects.toThrow(
      'Failed to publish event: 503 Service Unavailable',
    )
  })

  it('throws when subscribe does not upgrade', async () => {
    const stub = {
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as DurableObjectStub

    const namespace = {
      getByName: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace

    const publisher = new DurablePublisher<any>(namespace)

    await expect(publisher.subscribe('message', vi.fn())).rejects.toThrow(
      'Failed to open subscription websocket to publisher durable object',
    )
  })

  it('reports bad messages and socket errors but keeps good ones', async () => {
    const socket = makeSocket()
    const serializer = new RPCSerializer()
    const stub = {
      fetch: vi.fn(async () => ({
        webSocket: socket as unknown as WebSocket,
      } as Response)),
    } as unknown as DurableObjectStub

    const namespace = {
      getByName: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace

    const publisher = new DurablePublisher<any>(namespace)
    const listener = vi.fn()
    const onError = vi.fn()

    const unsubscribe = await publisher.subscribe('message', listener, { onError })

    socket.sendMessage('not-json')
    socket.sendMessage(JSON.stringify({ data: serializer.serialize({ text: 'good' }) }))

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    expect(listener).toHaveBeenCalledWith({ text: 'good' })

    socket.sendClose(1000, 'done')
    socket.sendClose(1001, 'going away')
    socket.sendClose(1011, 'crashed')
    socket.sendError()

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(3)
    })

    expect(onError.mock.calls[0]![0].message).toBe('Failed to deserialize message from publisher durable object')
    expect(onError.mock.calls[1]![0].message).toBe('WebSocket closed unexpectedly: 1011 crashed')
    expect(onError.mock.calls[2]![0].message).toBe('Subscription websocket error')

    await unsubscribe()

    expect(socket.closeCalls).toHaveLength(1)
  })
})
