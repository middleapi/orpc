import type { RedisClient } from './redis-event-publisher'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RedisEventPublisher } from './redis-event-publisher'

// Mock Redis client for testing
class MockRedisClient implements RedisClient {
  private subscriptions = new Map<string, (message: string) => void>()
  private publishedMessages: Array<{ channel: string, message: string }> = []

  async publish(channel: string, message: string): Promise<number> {
    this.publishedMessages.push({ channel, message })

    const callback = this.subscriptions.get(channel)
    if (callback) {
      setImmediate(() => callback(message))
    }

    return 1
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    this.subscriptions.set(channel, callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel)
  }

  async quit(): Promise<void> {
    this.subscriptions.clear()
    this.publishedMessages = []
  }

  getPublishedMessages() {
    return [...this.publishedMessages]
  }
}

describe('redisEventPublisher', () => {
  let mockRedis: MockRedisClient
  let publisher: RedisEventPublisher<{
    'test-event': { message: string }
    'user-updated': { id: string, name: string }
  }>

  beforeEach(() => {
    mockRedis = new MockRedisClient()
    publisher = new RedisEventPublisher({
      redis: mockRedis,
      keyPrefix: 'test:',
    })
  })

  afterEach(async () => {
    await publisher.close()
  })

  describe('publish', () => {
    it('should publish events to Redis', async () => {
      const payload = { message: 'Hello World' }

      await publisher.publish('test-event', payload)

      const publishedMessages = mockRedis.getPublishedMessages()
      expect(publishedMessages).toHaveLength(1)
      expect(publishedMessages[0]!.channel).toBe('test:test-event')

      const { json, meta } = JSON.parse(publishedMessages[0]!.message)
      expect(json).toEqual(payload)
      expect(meta).toEqual([])
    })

    it('should handle complex types', async () => {
      const payload = {
        message: 'Complex data',
        id: BigInt(123),
        createdAt: new Date('2023-01-01T00:00:00Z'),
        tags: new Set(['urgent', 'important']),
        metadata: new Map([['priority', 'high']]),
      }

      await publisher.publish('test-event', payload)

      const publishedMessages = mockRedis.getPublishedMessages()
      expect(publishedMessages).toHaveLength(1)

      const { json, meta } = JSON.parse(publishedMessages[0]!.message)
      expect(json.id).toBe('123')
      expect(json.createdAt).toBe('2023-01-01T00:00:00.000Z')
      expect(json.tags).toEqual(['urgent', 'important'])
      expect(json.metadata).toEqual([['priority', 'high']])
    })
  })

  describe('subscribe with callback', () => {
    it('should subscribe to events and receive messages', async () => {
      const receivedMessages: any[] = []
      const callback = (payload: any) => {
        receivedMessages.push(payload)
      }

      const unsubscribe = await publisher.subscribe('test-event', callback)

      await publisher.publish('test-event', { message: 'Hello' })

      await new Promise(resolve => setImmediate(resolve))

      expect(receivedMessages).toHaveLength(1)
      expect(receivedMessages[0]).toEqual({ message: 'Hello' })

      await unsubscribe()
    })

    it('should handle multiple subscribers', async () => {
      const receivedMessages1: any[] = []
      const receivedMessages2: any[] = []

      const callback1 = (payload: any) => receivedMessages1.push(payload)
      const callback2 = (payload: any) => receivedMessages2.push(payload)

      const unsubscribe1 = await publisher.subscribe('test-event', callback1)
      const unsubscribe2 = await publisher.subscribe('test-event', callback2)

      await publisher.publish('test-event', { message: 'Hello' })

      await new Promise(resolve => setImmediate(resolve))

      expect(receivedMessages1).toHaveLength(1)
      expect(receivedMessages1[0]).toEqual({ message: 'Hello' })
      expect(receivedMessages2).toHaveLength(1)
      expect(receivedMessages2[0]).toEqual({ message: 'Hello' })

      await unsubscribe1()
      await unsubscribe2()
    })

    it('should unsubscribe when no more listeners', async () => {
      const callback = vi.fn()
      const unsubscribe = await publisher.subscribe('test-event', callback)

      expect(publisher.size).toBe(1)

      await unsubscribe()

      expect(publisher.size).toBe(0)
    })
  })

  describe('subscribe with async iterator', () => {
    it('should work with for await...of', async () => {
      const receivedMessages: any[] = []

      const subscription = publisher.subscribe('test-event', {})

      await publisher.publish('test-event', { message: 'First' })
      await publisher.publish('test-event', { message: 'Second' })

      const iterator = subscription[Symbol.asyncIterator]()
      const result1 = await iterator.next()
      const result2 = await iterator.next()

      expect(result1.done).toBe(false)
      expect(result1.value).toEqual({ message: 'First' })
      expect(result2.done).toBe(false)
      expect(result2.value).toEqual({ message: 'Second' })

      await iterator.return?.(undefined)
    })

    it('should handle abort signal', async () => {
      const abortController = new AbortController()

      const subscription = publisher.subscribe('test-event', {
        signal: abortController.signal,
      })

      setTimeout(() => {
        abortController.abort()
      }, 10)

      const iterator = subscription[Symbol.asyncIterator]()

      try {
        await iterator.next()
        expect.fail('Should have thrown AbortError')
      }
      catch (error: any) {
        expect(error.name).toBe('AbortError')
      }
    })

    it('should buffer events when no consumer', async () => {
      const subscription = publisher.subscribe('test-event', {
        maxBufferedEvents: 2,
      })

      await publisher.publish('test-event', { message: 'First' })
      await publisher.publish('test-event', { message: 'Second' })
      await publisher.publish('test-event', { message: 'Third' })

      const iterator = subscription[Symbol.asyncIterator]()
      const result1 = await iterator.next()
      const result2 = await iterator.next()

      expect(result1.value).toEqual({ message: 'First' })
      expect(result2.value).toEqual({ message: 'Second' })

      await iterator.return?.(undefined)
    })
  })

  describe('close', () => {
    it('should clean up resources', async () => {
      const callback = vi.fn()
      await publisher.subscribe('test-event', callback)

      expect(publisher.size).toBe(1)

      await publisher.close()

      expect(publisher.size).toBe(0)
    })
  })
})
