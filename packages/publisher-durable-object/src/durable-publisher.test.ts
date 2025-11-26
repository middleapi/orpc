import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { describe, expect, it, vi } from 'vitest'
import { DurablePublisher } from './durable-publisher'

function createMockNamespace() {
  const stubs = new Map<string, ReturnType<typeof createMockStub>>()

  function createMockStub() {
    const websockets: any[] = []
    const messageListeners: ((event: any) => void)[] = []
    const errorListeners: ((event: any) => void)[] = []
    const closeListeners: ((event: any) => void)[] = []
    let publishedMessages: string[] = []

    const mockWebSocket = {
      addEventListener: vi.fn((type: string, listener: any) => {
        if (type === 'message') {
          messageListeners.push(listener)
        }
        else if (type === 'error') {
          errorListeners.push(listener)
        }
        else if (type === 'close') {
          closeListeners.push(listener)
        }
      }),
      accept: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    }

    return {
      fetch: vi.fn(async (urlOrRequest: string | Request, init?: RequestInit) => {
        // Handle both Request object and URL string with init
        const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url
        const headers = typeof urlOrRequest === 'string'
          ? new Headers(init?.headers)
          : urlOrRequest.headers

        if (url.includes('/publish')) {
          const body = typeof urlOrRequest === 'string'
            ? init?.body as string
            : await urlOrRequest.text()
          publishedMessages.push(body)
          // Broadcast to all websockets
          for (const ws of websockets) {
            ws.send(body)
          }
          return new Response(null, { status: 204 })
        }

        // Subscribe request
        websockets.push(mockWebSocket)
        return {
          ok: true,
          webSocket: mockWebSocket,
          headers,
        } as any
      }),
      getPublishedMessages: () => publishedMessages,
      getMockWebSocket: () => mockWebSocket,
      getMessageListeners: () => messageListeners,
      getErrorListeners: () => errorListeners,
      getCloseListeners: () => closeListeners,
      clearMessages: () => {
        publishedMessages = []
      },
    }
  }

  return {
    getByName: vi.fn((name: string) => {
      if (!stubs.has(name)) {
        stubs.set(name, createMockStub())
      }
      return stubs.get(name)!
    }),
    getStubs: () => stubs,
  }
}

type TestEvents = {
  message: { text: string }
  count: { value: number }
  user: { id: string, name: string }
  complex: { date: Date, nested: { items: string[] } }
}

class Person {
  constructor(public name: string, public age: number) {}
}

const customJsonSerializers = [
  {
    type: 100,
    condition: (data: unknown): data is Person => data instanceof Person,
    serialize: (data: Person) => ({ name: data.name, age: data.age }),
    deserialize: (serialized: any) => new Person(serialized.name, serialized.age),
  },
]

describe('durablePublisher', () => {
  describe('publish', () => {
    it('should serialized and publish event to durable object', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher(namespace as any, {
        customJsonSerializers,
      })

      const payload = withEventMeta({
        date: new Date(),
        person: new Person('Alice', 30),
      }, { id: 'event-1', retry: 5000, comments: ['test'] })
      await publisher.publish('message', payload)

      expect(namespace.getByName).toHaveBeenCalledWith('message')
      const stub = namespace.getStubs().get('message')!
      expect(stub.fetch).toHaveBeenCalled()

      const messages = stub.getPublishedMessages()
      expect(messages).toHaveLength(1)
      const parsed = JSON.parse(messages[0]!)
      expect(parsed.data).toEqual({
        json: { date: payload.date.toISOString(), person: { name: 'Alice', age: 30 } },
        meta: [[1, 'date'], [100, 'person']],
      })
      expect(parsed.meta).toEqual({ id: 'event-1', retry: 5000, comments: ['test'] })
    })

    it('should use prefix for event name', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher<TestEvents>(namespace as any, {
        prefix: 'my-prefix:',
      })

      await publisher.publish('message', { text: 'hello' })

      expect(namespace.getByName).toHaveBeenCalledWith('my-prefix:message')
    })

    it('should use custom getStubByName', async () => {
      const namespace = createMockNamespace()
      const customGetStub = vi.fn((ns: any, event: string) => ns.getByName(`custom:${event}`))
      const publisher = new DurablePublisher<TestEvents>(namespace as any, {
        getStubByName: customGetStub,
      })

      await publisher.publish('message', { text: 'hello' })

      expect(customGetStub).toHaveBeenCalledWith(namespace, 'message')
      expect(namespace.getByName).toHaveBeenCalledWith('custom:message')
    })

    it('should throw error when publish fails', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher(namespace as any)

      const stub = namespace.getStubs().get('message') ?? (namespace.getByName('message') as any)
      stub.fetch.mockResolvedValueOnce(new Response(null, { status: 500, statusText: 'Internal Server Error' }))

      await expect(publisher.publish('message', { text: 'hello' }))
        .rejects
        .toThrow('Failed to publish event: 500 Internal Server Error')
    })
  })

  describe('subscribe', () => {
    it('should subscribe to events via websocket', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher(namespace as any)

      const listener = vi.fn()
      const unsub = await publisher.subscribe('message', listener)

      expect(namespace.getByName).toHaveBeenCalledWith('message')
      const stub = namespace.getStubs().get('message')!
      expect(stub.getMockWebSocket().accept).toHaveBeenCalled()

      await unsub()
      expect(stub.getMockWebSocket().close).toHaveBeenCalled()
    })

    const stringifiedMessage = JSON.stringify({
      data: { json: { person: { name: 'Alice', age: 30 } }, meta: [[100, 'person']] },
      meta: { id: '1' },
    })
    it.each([
      ['Text', stringifiedMessage],
      ['Blob', new Blob([stringifiedMessage])],
      ['ArrayBuffer', new TextEncoder().encode(stringifiedMessage).buffer],
    ])('should receive and deserialize messages $0', async (_type, data) => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher<TestEvents>(namespace as any)

      const listener = vi.fn()
      const unsub = await publisher.subscribe('message', listener)

      const stub = namespace.getStubs().get('message')!
      const messageListeners = stub.getMessageListeners()

      messageListeners[0]!({ data })

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(listener).toHaveBeenCalledTimes(1)
      const received = listener.mock.calls[0]![0]
      expect(received).toEqual({ person: new Person('Alice', 30) })
      expect(getEventMeta(received)).toEqual({ id: '1' })

      await unsub()
    })

    it('should use prefix for subscribe', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher<TestEvents>(namespace as any, {
        prefix: 'events:',
      })

      const listener = vi.fn()
      const unsub = await publisher.subscribe('message', listener)

      expect(namespace.getByName).toHaveBeenCalledWith('events:message')

      await unsub()
    })

    it('should throw if websocket not returned', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher<TestEvents>(namespace as any)

      const stub = namespace.getByName('message') as any
      stub.fetch.mockResolvedValueOnce({ ok: true, webSocket: null })

      await expect(publisher.subscribe('message', vi.fn()))
        .rejects
        .toThrow('Failed to open subscription websocket to publisher durable object')
    })

    it('should pass lastEventId in headers', async () => {
      const namespace = createMockNamespace()
      const publisher = new DurablePublisher<TestEvents>(namespace as any)

      const listener = vi.fn()
      const unsub = await publisher.subscribe('message', listener, { lastEventId: '42' })

      const stub = namespace.getStubs().get('message')!
      expect(stub.fetch).toHaveBeenCalled()

      const fetchCall = stub.fetch.mock.calls[0]!
      const init = fetchCall[1] as RequestInit
      const headers = new Headers(init.headers)
      expect(headers.get('last-event-id')).toBe('42')

      await unsub()
    })

    describe('error handling', () => {
      it('should call onError for message processing errors', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const onError = vi.fn()
        const unsub = await publisher.subscribe('message', listener, { onError })

        const stub = namespace.getStubs().get('message')!
        const messageListeners = stub.getMessageListeners()

        // Simulate receiving invalid JSON
        messageListeners[0]!({ data: 'invalid json' })

        await new Promise(resolve => setTimeout(resolve, 0))

        expect(onError).toHaveBeenCalled()
        expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error)
        expect(listener).not.toHaveBeenCalled()

        await unsub()
      })

      it('should call onError for websocket errors', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const onError = vi.fn()
        const unsub = await publisher.subscribe('message', listener, { onError })

        const stub = namespace.getStubs().get('message')!
        const errorListeners = stub.getErrorListeners()

        // Simulate websocket error
        const errorEvent = { type: 'error' }
        errorListeners[0]!(errorEvent)

        expect(onError).toHaveBeenCalled()
        const error = onError.mock.calls[0]![0] as Error
        expect(error.message).toBe('Subscription websocket error')
        expect(error.cause).toBe(errorEvent)

        await unsub()
      })

      it('should call onError for unexpected websocket close', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const onError = vi.fn()
        const unsub = await publisher.subscribe('message', listener, { onError })

        const stub = namespace.getStubs().get('message')!
        const closeListeners = stub.getCloseListeners()

        // Simulate unexpected close (code 1006 = abnormal closure)
        closeListeners[0]!({ code: 1006, reason: 'Connection lost' })

        expect(onError).toHaveBeenCalled()
        const error = onError.mock.calls[0]![0] as Error
        expect(error.message).toBe('WebSocket closed unexpectedly: 1006 Connection lost')

        await unsub()
      })

      it('should not call onError for normal close (1000)', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const onError = vi.fn()
        const unsub = await publisher.subscribe('message', listener, { onError })

        const stub = namespace.getStubs().get('message')!
        const closeListeners = stub.getCloseListeners()

        // Simulate normal close
        closeListeners[0]!({ code: 1000, reason: '' })

        expect(onError).not.toHaveBeenCalled()

        await unsub()
      })

      it('should not call onError for going away close (1001)', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const onError = vi.fn()
        const unsub = await publisher.subscribe('message', listener, { onError })

        const stub = namespace.getStubs().get('message')!
        const closeListeners = stub.getCloseListeners()

        // Simulate going away close
        closeListeners[0]!({ code: 1001, reason: 'Going away' })

        expect(onError).not.toHaveBeenCalled()

        await unsub()
      })
    })

    describe('edge case', () => {
      it('should not apply meta when serialized.meta is undefined', async () => {
        const namespace = createMockNamespace()
        const publisher = new DurablePublisher<TestEvents>(namespace as any)

        const listener = vi.fn()
        const unsub = await publisher.subscribe('message', listener)

        const stub = namespace.getStubs().get('message')!
        const messageListeners = stub.getMessageListeners()

        // Message without meta field
        const serializedMessage = JSON.stringify({
          data: { json: { text: 'no-meta' }, meta: [] },
        // no meta field
        })
        messageListeners[0]!({ data: serializedMessage })

        await new Promise(resolve => setTimeout(resolve, 0))

        expect(listener).toHaveBeenCalledTimes(1)
        const received = listener.mock.calls[0]![0]
        expect(received).toEqual({ text: 'no-meta' })
        expect(getEventMeta(received)).toBeUndefined()

        await unsub()
      })
    })
  })
})
