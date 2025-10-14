import type Redis from 'ioredis'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IORedisPublisher } from './ioredis'

describe('iORedisPublisher', () => {
  let mockRedis: {
    publish: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    unsubscribe: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    off: ReturnType<typeof vi.fn>
    xadd: ReturnType<typeof vi.fn>
    xread: ReturnType<typeof vi.fn>
    xtrim: ReturnType<typeof vi.fn>
    expire: ReturnType<typeof vi.fn>
    multi: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockRedis = {
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      xadd: vi.fn().mockResolvedValue('1-0'),
      xread: vi.fn().mockResolvedValue(null),
      xtrim: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
      multi: vi.fn().mockReturnValue({
        xadd: vi.fn().mockReturnThis(),
        xtrim: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, '1-0'],
          [null, 0],
          [null, 1],
        ]),
      }),
    }
  })

  it('without resume: can pub/sub but not resume', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis) // resume is disabled by default

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    const unsub1 = await publisher.subscribe('event1', listener1)
    const unsub2 = await publisher.subscribe('event2', listener2)

    expect(mockRedis.subscribe).toHaveBeenCalledWith('orpc:publisher:event1')
    expect(mockRedis.subscribe).toHaveBeenCalledWith('orpc:publisher:event2')
    expect(mockRedis.on).toHaveBeenCalledWith('message', expect.any(Function))

    const payload1 = { order: 1 }
    const payload2 = { order: 2 }

    await publisher.publish('event1', payload1)
    await publisher.publish('event3', payload2)

    expect(mockRedis.publish).toHaveBeenCalledTimes(2)
    expect(mockRedis.xadd).not.toHaveBeenCalled() // resume disabled

    // Simulate Redis message callback
    const messageHandler = mockRedis.on.mock.calls[0]![1] as (channel: string, message: string) => void
    messageHandler('orpc:publisher:event1', JSON.stringify({ json: payload1, meta: [], eventMeta: undefined }))
    messageHandler('orpc:publisher:event3', JSON.stringify({ json: payload2, meta: [], eventMeta: undefined }))

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener1).toHaveBeenCalledWith(payload1)
    expect(listener2).toHaveBeenCalledTimes(0)

    await unsub1()

    messageHandler('orpc:publisher:event1', JSON.stringify({ json: payload2, meta: [], eventMeta: undefined }))
    messageHandler('orpc:publisher:event2', JSON.stringify({ json: payload2, meta: [], eventMeta: undefined }))

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledWith(payload2)

    await unsub2()

    const listener3 = vi.fn()
    const unsub11 = await publisher.subscribe('event1', listener3, { lastEventId: '0' })

    // Wait a bit for potential async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(listener3).toHaveBeenCalledTimes(0) // resume not happens (no xread called)
    expect(mockRedis.xread).not.toHaveBeenCalled() // resume disabled
    await unsub11()

    expect(publisher.size).toEqual(0) // ensure no memory leak
  })

  describe('with resume', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('publishes with xadd when resume enabled', async () => {
      const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

      await publisher.publish('event1', { order: 1 })
      await publisher.publish('event2', { order: 2 })

      // First publish for each event triggers multi with xtrim
      expect(mockRedis.multi).toHaveBeenCalledTimes(2)
      expect(mockRedis.publish).toHaveBeenCalledTimes(2)
    })

    it('uses xadd for subsequent publishes to same event', async () => {
      const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

      await publisher.publish('event1', { order: 1 })
      await publisher.publish('event1', { order: 2 })

      // First publish uses multi, second uses xadd
      expect(mockRedis.multi).toHaveBeenCalledTimes(1)
      expect(mockRedis.xadd).toHaveBeenCalledTimes(1)
    })

    it('cleanup expired events tracking on publish', async () => {
      const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

      await publisher.publish('event1', { order: 1 })
      await publisher.publish('event2', { order: 2 })
      await publisher.publish('event3', { order: 3 })

      // First publish for each event triggers multi
      expect(mockRedis.multi).toHaveBeenCalledTimes(3)

      vi.advanceTimersByTime(1100) // expired (1 second + buffer)
      await publisher.publish('event1', { order: 4 })

      // event1's lastCleanupTime has expired, so it triggers multi again
      expect(mockRedis.multi).toHaveBeenCalledTimes(4)
    })

    it('calls xread when subscribing with lastEventId', async () => {
      vi.useRealTimers() // Use real timers for this test
      const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

      mockRedis.xread.mockResolvedValueOnce(null)

      const listener = vi.fn()
      await publisher.subscribe('event1', listener, { lastEventId: '0' })

      // Wait for async xread to be called
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRedis.xread).toHaveBeenCalledWith('STREAMS', 'orpc:publisher:event1', '0')
      vi.useFakeTimers() // Restore fake timers
    })

    it('handles xread errors gracefully', async () => {
      vi.useRealTimers() // Use real timers for this test
      const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

      // Mock xread to throw error
      mockRedis.xread.mockRejectedValueOnce(new Error('Redis connection error'))

      const listener = vi.fn()
      await publisher.subscribe('event1', listener, { lastEventId: '0' })

      // Wait for async xread to complete (and fail)
      await new Promise(resolve => setTimeout(resolve, 50))

      // Simulate message arriving after error
      const messageHandler = mockRedis.on.mock.calls[0]![1] as (channel: string, message: string) => void
      const payload = { order: 1 }
      messageHandler('orpc:publisher:event1', JSON.stringify({ json: payload, meta: [], eventMeta: undefined, id: '1-0' }))

      // Should still receive new messages despite xread error
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining(payload))
      vi.useFakeTimers() // Restore fake timers
    })
  })

  it('uses custom prefix', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { prefix: 'custom:prefix:' })

    const listener = vi.fn()
    await publisher.subscribe('event1', listener)

    expect(mockRedis.subscribe).toHaveBeenCalledWith('custom:prefix:event1')

    await publisher.publish('event1', { order: 1 })

    expect(mockRedis.publish).toHaveBeenCalledWith('custom:prefix:event1', expect.any(String))
  })

  it('handles multiple listeners for same event', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis)

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    await publisher.subscribe('event1', listener1)
    await publisher.subscribe('event1', listener2)
    await publisher.subscribe('event1', listener3)

    // Should only subscribe once to Redis
    expect(mockRedis.subscribe).toHaveBeenCalledTimes(1)
    expect(mockRedis.subscribe).toHaveBeenCalledWith('orpc:publisher:event1')

    const payload = { order: 1 }
    const messageHandler = mockRedis.on.mock.calls[0]![1] as (channel: string, message: string) => void
    messageHandler('orpc:publisher:event1', JSON.stringify({ json: payload, meta: [], eventMeta: undefined }))

    expect(listener1).toHaveBeenCalledWith(payload)
    expect(listener2).toHaveBeenCalledWith(payload)
    expect(listener3).toHaveBeenCalledWith(payload)

    expect(publisher.size).toEqual(4) // 1 redisListener + 3 listeners
  })

  it('cleans up Redis listener when all subscriptions removed', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis)

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    const unsub1 = await publisher.subscribe('event1', listener1)
    const unsub2 = await publisher.subscribe('event2', listener2)

    expect(mockRedis.on).toHaveBeenCalledTimes(1)
    expect(publisher.size).toEqual(3) // 1 redisListener + 2 listeners

    await unsub1()
    expect(mockRedis.off).not.toHaveBeenCalled()
    expect(publisher.size).toEqual(2)

    await unsub2()
    expect(mockRedis.off).toHaveBeenCalledWith('message', expect.any(Function))
    expect(publisher.size).toEqual(0)
  })

  it('handles multi exec errors', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

    // Mock multi to return error
    mockRedis.multi.mockReturnValueOnce({
      xadd: vi.fn().mockReturnThis(),
      xtrim: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [new Error('Redis error'), null],
        [null, 0],
        [null, 1],
      ]),
    })

    await expect(publisher.publish('event1', { order: 1 })).rejects.toThrow('Redis error')
  })

  it('deserializes payloads with event metadata', async () => {
    const publisher = new IORedisPublisher(mockRedis as unknown as Redis, { resumeRetentionSeconds: 1 })

    const listener = vi.fn()
    await publisher.subscribe('event1', listener)

    const payload = withEventMeta({ order: 1 }, { comments: ['test'] })
    await publisher.publish('event1', payload)

    // Simulate Redis message with id
    const messageHandler = mockRedis.on.mock.calls[0]![1] as (channel: string, message: string) => void
    messageHandler('orpc:publisher:event1', JSON.stringify({
      json: { order: 1 },
      meta: [],
      eventMeta: { comments: ['test'] },
      id: '1-0',
    }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.toSatisfy((p) => {
      expect(p).toEqual({ order: 1 })
      expect(getEventMeta(p)).toEqual({ id: '1-0', comments: ['test'] })
      return true
    }))
  })
})
