import type { PublisherSubscribeListenerOptions } from './publisher'
import { Publisher } from './publisher'

// Concrete implementation for testing
class TestPublisher<T extends Record<string, object>> extends Publisher<T> {
  listeners = new Map<keyof T, Set<(payload: any) => void>>()

  async publish<K extends keyof T>(event: K, payload: T[K]): Promise<void> {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(listener => listener(payload))
    }
  }

  protected async subscribeListener<K extends keyof T>(
    event: K,
    listener: (payload: T[K]) => void,
    options?: PublisherSubscribeListenerOptions,
  ): Promise<() => Promise<void>> {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)

    return async () => {
      this.listeners.get(event)?.delete(listener)
    }
  }
}

type TestEvents = {
  message: { text: string }
  count: { value: number }
  user: { id: string, name: string }
}

describe('publisher', () => {
  let publisher: TestPublisher<TestEvents>

  beforeEach(() => {
    publisher = new TestPublisher<TestEvents>()
  })

  afterEach(() => {
    let size = 0
    for (const listeners of publisher.listeners.values()) {
      size += listeners.size
    }
    expect(size).toBe(0) // ensure all listeners are unsubscribed correctly
  })

  describe('subscribe with callback', () => {
    it('should subscribe and receive events', async () => {
      const listener = vi.fn()
      const unsub = await publisher.subscribe('message', listener)

      await publisher.publish('message', { text: 'hello' })

      expect(listener).toHaveBeenCalledWith({ text: 'hello' })
      expect(listener).toHaveBeenCalledTimes(1)

      await unsub()
    })

    it('should handle multiple subscribers', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = await publisher.subscribe('message', listener1)
      const unsub2 = await publisher.subscribe('message', listener2)

      await publisher.publish('message', { text: 'hello' })

      expect(listener1).toHaveBeenCalledWith({ text: 'hello' })
      expect(listener2).toHaveBeenCalledWith({ text: 'hello' })

      await unsub1()
      await unsub2()
    })

    it('should unsubscribe correctly', async () => {
      const listener = vi.fn()
      const unsubscribe = await publisher.subscribe('message', listener)

      await publisher.publish('message', { text: 'first' })
      await unsubscribe()
      await publisher.publish('message', { text: 'second' })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ text: 'first' })
    })
  })

  describe('subscribe with async iterator', () => {
    it('should iterate over events', async () => {
      const events: string[] = []
      const iterator = publisher.subscribe('message')

      setTimeout(() => {
        publisher.publish('message', { text: 'first' })
        publisher.publish('message', { text: 'second' })
        publisher.publish('message', { text: 'third' })
        setTimeout(() => iterator.return(), 50)
      }, 10)

      for await (const payload of iterator) {
        events.push(payload.text)
      }

      expect(events).toEqual(['first', 'second', 'third'])
    })

    it('should buffer events when consumer is slow', async () => {
      const iterator = publisher.subscribe('message', { maxBufferedEvents: 3 })

      // Publish events before consuming
      await publisher.publish('message', { text: 'first' })
      await publisher.publish('message', { text: 'second' })
      await publisher.publish('message', { text: 'third' })

      const result1 = await iterator.next()
      const result2 = await iterator.next()
      const result3 = await iterator.next()

      expect(result1.value?.text).toBe('first')
      expect(result2.value?.text).toBe('second')
      expect(result3.value?.text).toBe('third')

      await iterator.return()
    })

    it('should drop oldest events when buffer exceeds maxBufferedEvents', async () => {
      const iterator = publisher.subscribe('message', { maxBufferedEvents: 2 })

      // Publish 4 events, buffer can only hold 2
      await publisher.publish('message', { text: 'first' })
      await publisher.publish('message', { text: 'second' })
      await publisher.publish('message', { text: 'third' })
      await publisher.publish('message', { text: 'fourth' })

      const result1 = await iterator.next()
      const result2 = await iterator.next()

      // First two should be dropped, we get third and fourth
      expect(result1.value?.text).toBe('third')
      expect(result2.value?.text).toBe('fourth')

      await iterator.return()
    })

    it('should handle maxBufferedEvents of 0', async () => {
      const iterator = publisher.subscribe('message', { maxBufferedEvents: 0 })

      // Publish event before consuming - should be dropped
      await publisher.publish('message', { text: 'dropped' })

      // Start consuming
      const nextPromise = iterator.next()
      await new Promise(resolve => setTimeout(resolve, 1))

      // Publish while waiting
      await publisher.publish('message', { text: 'received' })

      const result = await nextPromise
      expect(result.value?.text).toBe('received')

      await iterator.return()
    })

    it('should handle maxBufferedEvents of 1', async () => {
      const iterator = publisher.subscribe('message', { maxBufferedEvents: 1 })

      await publisher.publish('message', { text: 'first' })
      await publisher.publish('message', { text: 'second' })

      const result = await iterator.next()
      // Only the latest event is kept
      expect(result.value?.text).toBe('second')

      await iterator.return()
    })

    it('should abort with signal', async () => {
      const controller = new AbortController()
      const iterator = publisher.subscribe('message', { signal: controller.signal })

      const nextPromise = iterator.next()
      controller.abort(new Error('Aborted'))

      await expect(nextPromise).rejects.toThrow('Aborted')
    })

    it('should throw if signal is already aborted', () => {
      const controller = new AbortController()
      controller.abort(new Error('Already aborted'))

      expect(() => {
        publisher.subscribe('message', { signal: controller.signal })
      }).toThrow('Already aborted')
    })

    it('should cleanup on abort', async () => {
      const controller = new AbortController()
      const iterator = publisher.subscribe('message', { signal: controller.signal })

      const nextPromise = iterator.next()
      controller.abort()
      await expect(nextPromise).rejects.toThrow('This operation was aborted')

      // Publishing after abort should not affect the iterator
      await publisher.publish('message', { text: 'after abort' })

      const result = await iterator.next()
      expect(result.done).toBe(true)
    })

    it('should cleanup on return', async () => {
      const iterator = publisher.subscribe('message')

      await publisher.publish('message', { text: 'first' })
      await iterator.next()

      const returnResult = await iterator.return()
      expect(returnResult.done).toBe(true)

      // Further iterations should be done
      const result = await iterator.next()
      expect(result.done).toBe(true)
    })

    it('should handle concurrent consumers', async () => {
      const iterator1 = publisher.subscribe('message')
      const iterator2 = publisher.subscribe('message')

      await publisher.publish('message', { text: 'concurrent' })

      const [result1, result2] = await Promise.all([
        iterator1.next(),
        iterator2.next(),
      ])

      expect(result1.value?.text).toBe('concurrent')
      expect(result2.value?.text).toBe('concurrent')

      await iterator1.return()
      await iterator2.return()
    })

    it('should use instance maxBufferedEvents by default', async () => {
      const pub = new TestPublisher<TestEvents>({ maxBufferedEvents: 1 })
      const iterator = pub.subscribe('message')

      await pub.publish('message', { text: 'first' })
      await pub.publish('message', { text: 'second' })

      const result = await iterator.next()
      expect(result.value?.text).toBe('second')

      await iterator.return()
    })

    it('should override instance maxBufferedEvents with options', async () => {
      const pub = new TestPublisher<TestEvents>({ maxBufferedEvents: 1 })
      const iterator = pub.subscribe('message', { maxBufferedEvents: 3 })

      await pub.publish('message', { text: 'first' })
      await pub.publish('message', { text: 'second' })

      const result1 = await iterator.next()
      const result2 = await iterator.next()

      expect(result1.value?.text).toBe('first')
      expect(result2.value?.text).toBe('second')

      await iterator.return()
    })

    it('should handle rapid publishing and consuming', async () => {
      const iterator = publisher.subscribe('count')
      const received: number[] = []

      const publishPromise = (async () => {
        for (let i = 0; i < 100; i++) {
          await publisher.publish('count', { value: i })
        }
      })()

      for (let i = 0; i < 100; i++) {
        const result = await iterator.next()
        if (!result.done) {
          received.push(result.value.value)
        }
      }

      await publishPromise
      await iterator.return()

      expect(received).toHaveLength(100)
    })
  })
})
