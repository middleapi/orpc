import type { IORedisPublisherOptions } from './ioredis'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { Redis } from 'ioredis'
import { IORedisPublisher } from './ioredis'

const REDIS_URL = process.env.REDIS_URL

/**
 * These tests depend on a real Redis server — make sure to set the `REDIS_URL` env.
 * When writing new tests, always use unique keys to avoid conflicts with other test cases.
 */
describe.concurrent('ioredis publisher', { skip: !REDIS_URL, timeout: 20000 }, () => {
  let commander: Redis
  let listener: Redis
  const createdPublishers: IORedisPublisher<any>[] = []

  function createTestingPublisher(options: Partial<IORedisPublisherOptions> = {}) {
    const publisher = new IORedisPublisher({
      commander,
      listener,
      prefix: crypto.randomUUID(), // isolated from other tests
      ...options,
    })

    publisher.xtrimExactness = '=' // for easier testing

    createdPublishers.push(publisher)

    return publisher
  }

  beforeAll(() => {
    commander = new Redis(REDIS_URL!)
    listener = new Redis(REDIS_URL!)
  })

  afterAll(async () => {
    await commander.quit()
    await listener.quit()

    expect(commander.listenerCount('message')).toEqual(0)
    expect(commander.listenerCount('error')).toEqual(0)
    expect(listener.listenerCount('message')).toEqual(0)
    expect(listener.listenerCount('error')).toEqual(0)
    for (const publisher of createdPublishers) {
      expect(publisher.size).toEqual(0) // ensure cleanup correctly
    }
  })

  it('without resume: can pub/sub but not resume', async () => {
    const publisher = createTestingPublisher() // resume is disabled by default

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    const unsub1 = await publisher.subscribe('event1', listener1)
    const unsub2 = await publisher.subscribe('event2', listener2)

    const payload1 = { order: 1 }
    const payload2 = { order: 2 }

    await publisher.publish('event1', payload1)
    await publisher.publish('event3', payload2)

    await vi.waitFor(() => {
      expect(listener1).toHaveBeenCalledTimes(1)
    })
    expect(listener1.mock.calls[0]![0]).toEqual(payload1)
    expect(listener2).toHaveBeenCalledTimes(0)

    await unsub1()

    await publisher.publish('event1', payload2)
    await publisher.publish('event2', payload2)

    await vi.waitFor(() => {
      expect(listener2).toHaveBeenCalledTimes(1)
    })
    expect(listener2.mock.calls[0]![0]).toEqual(payload2)
    expect(listener1).toHaveBeenCalledTimes(1)

    await unsub2()

    const unsub11 = await publisher.subscribe('event1', listener1, { lastEventId: '0' })

    // Wait a bit to ensure no resume happens
    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(listener1).toHaveBeenCalledTimes(1) // resume not happens
    await unsub11()
  })

  describe('with resume', () => {
    it('basic pub/sub', async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      const listener1 = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener1)

      const payload1 = { order: 1 }
      await publisher.publish('event1', payload1)

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(1)
      })
      expect(listener1).toHaveBeenCalledWith(expect.objectContaining(payload1))

      await unsub1()
    })

    it('can pub/sub and resume', async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = await publisher.subscribe('event1', listener1)
      const unsub2 = await publisher.subscribe('event2', listener2)

      const payload1 = { order: 1 }
      const payload2 = { order: 2 }

      await publisher.publish('event1', payload1)
      await publisher.publish('event3', payload2)

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(1)
      })
      expect(listener1).toHaveBeenCalledWith(expect.objectContaining(payload1))
      expect(listener2).toHaveBeenCalledTimes(0)

      await unsub1()

      await publisher.publish('event1', payload2)
      await publisher.publish('event2', payload2)

      await vi.waitFor(() => {
        expect(listener2).toHaveBeenCalledTimes(1)
      })
      expect(listener2).toHaveBeenCalledWith(expect.objectContaining(payload2))
      expect(listener1).toHaveBeenCalledTimes(1)

      await unsub2()

      const listener3 = vi.fn()
      const unsub3 = await publisher.subscribe('event1', listener3, { lastEventId: '0' })

      await vi.waitFor(() => {
        expect(listener3).toHaveBeenCalledTimes(2)
      })
      expect(listener3).toHaveBeenNthCalledWith(1, expect.objectContaining(payload1))
      expect(listener3).toHaveBeenNthCalledWith(2, expect.objectContaining(payload2))

      await unsub3()
      expect(publisher.size).toEqual(0) // all listeners unsubscribed
    })

    it('control event.id', async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      const listener1 = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener1)

      const payload1 = { order: 1 }
      const payload2 = withEventMeta({ order: 2 }, { id: 'some-id', comments: ['hello'] })

      await publisher.publish('event1', payload1)
      await publisher.publish('event1', payload2)

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(2)
      })
      expect(listener1).toHaveBeenNthCalledWith(1, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload1)
        expect(p).toEqual(payload1)
        const meta = getEventMeta(p)
        expect(meta?.id).toBeDefined()
        expect(typeof meta?.id).toBe('string')
        return true
      }))
      expect(listener1).toHaveBeenNthCalledWith(2, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload2)
        expect(p).toEqual(payload2)
        const meta = getEventMeta(p)
        expect(meta?.id).toBeDefined()
        expect(typeof meta?.id).toBe('string')
        expect(meta?.comments).toEqual(['hello'])
        return true
      }))

      const firstEventId = getEventMeta(listener1.mock.calls[0]![0])?.id

      const listener2 = vi.fn()
      const unsub2 = await publisher.subscribe('event1', listener2, { lastEventId: firstEventId })

      await vi.waitFor(() => {
        expect(listener2).toHaveBeenCalledTimes(1) // resume
      })
      expect(listener2).toHaveBeenNthCalledWith(1, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload2)
        expect(p).toEqual(payload2)
        const meta = getEventMeta(p)
        expect(meta?.id).toEqual(getEventMeta(listener1.mock.calls[1]![0])?.id)
        expect(meta?.comments).toEqual(['hello'])
        return true
      }))

      await unsub1()
      await unsub2()
      expect(publisher.size).toEqual(0) // ensure no memory leak
    })

    it('resume event.id > lastEventId and in order', async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      const listener1 = vi.fn()
      const unsub1 = await publisher.subscribe('event', listener1)

      // Publish 10 events
      for (let i = 1; i <= 10; i++) {
        await publisher.publish('event', { order: i })
      }

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(10)
      })

      // Get the ID of the 5th event
      const fifthEventId = getEventMeta(listener1.mock.calls[4]![0])?.id

      if (!fifthEventId) {
        throw new Error('No event ID found')
      }

      await unsub1()

      // Now subscribe with lastEventId set to the 5th event
      // Should receive events 6-10
      const listener2 = vi.fn()
      const unsub2 = await publisher.subscribe('event', listener2, { lastEventId: fifthEventId })

      // Wait for resume to complete
      await vi.waitFor(() => {
        expect(listener2).toHaveBeenCalledTimes(5)
      })
      expect(listener2).toHaveBeenNthCalledWith(1, expect.objectContaining({ order: 6 }))
      expect(listener2).toHaveBeenNthCalledWith(2, expect.objectContaining({ order: 7 }))
      expect(listener2).toHaveBeenNthCalledWith(5, expect.objectContaining({ order: 10 }))

      // Verify order
      for (let i = 0; i < listener2.mock.calls.length - 1; i++) {
        const current = listener2.mock.calls[i]![0].order
        const next = listener2.mock.calls[i + 1]![0].order
        expect(next).toBeGreaterThan(current)
      }

      await unsub2()
    })

    it('handles errors during resume gracefully', async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      const listener1 = vi.fn()
      const onError1 = vi.fn()

      // Subscribe with an invalid lastEventId to trigger error in xread
      const unsub1 = await publisher.subscribe('event1', listener1, { lastEventId: 'invalid-id-format', onError: onError1 })

      // Publish an event
      await publisher.publish('event1', { order: 1 })

      await vi.waitFor(() => {
        expect(onError1).toHaveBeenCalledTimes(1)
        // Should have received the new event even though resume failed
        expect(listener1).toHaveBeenCalledTimes(1)
      })
      expect(listener1).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))

      await unsub1()
    })

    it('handles race condition where events published during resume', { repeats: 5 }, async () => {
      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
      })

      await publisher.publish('event1', { order: 1 })
      await new Promise(resolve => setTimeout(resolve, 150)) // wait a bit
      await publisher.publish('event1', { order: 2 })

      publisher.publish('event1', { order: 3 })
      publisher.publish('event1', { order: 4 })
      const listener1 = vi.fn()
      const unsub = await publisher.subscribe('event1', listener1, { lastEventId: '0' })

      await publisher.publish('event1', { order: 5 })
      await publisher.publish('event1', { order: 6 })

      await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalledTimes(6) // no duplicates
      })
      expect(listener1).toHaveBeenNthCalledWith(1, expect.objectContaining({ order: 1 }))
      expect(listener1).toHaveBeenNthCalledWith(2, expect.objectContaining({ order: 2 }))
      expect(listener1).toHaveBeenNthCalledWith(3, expect.objectContaining({ order: 3 }))
      expect(listener1).toHaveBeenNthCalledWith(4, expect.objectContaining({ order: 4 }))
      expect(listener1).toHaveBeenNthCalledWith(5, expect.objectContaining({ order: 5 }))
      expect(listener1).toHaveBeenNthCalledWith(6, expect.objectContaining({ order: 6 }))

      await unsub()
    })

    describe('cleanup retention', () => {
      it('handles cleanup of expired events on publish', async () => {
        const prefix = `cleanup:${crypto.randomUUID()}:`
        const publisher = createTestingPublisher({
          resumeRetentionSeconds: 1,
          prefix,
        })

        const key1 = `${prefix}event1`

        // Publish events to event1
        await Promise.all([
          publisher.publish('event1', { order: 1 }),
          publisher.publish('event1', { order: 2 }),
          publisher.publish('event1', { order: 3 }),
        ])

        const beforeCleanup = await commander.xread('STREAMS', key1, '0')
        expect(beforeCleanup![0]![1].length).toBe(3)

        // Wait for retention to expire
        await new Promise(resolve => setTimeout(resolve, 1100))

        // Trigger cleanup by publishing a new event to event1
        await publisher.publish('event1', { order: 4 })

        const afterCleanup = await commander.xread('STREAMS', key1, '0')
        expect(afterCleanup![0]![1].length).toBe(1) // old events should be trimmed
      })

      it('verifies Redis auto-expires keys after retention period * 2', async () => {
        const prefix = `expire:${crypto.randomUUID()}:`
        const publisher = createTestingPublisher({
          resumeRetentionSeconds: 1,
          prefix,
        })

        const key = `${prefix}event1`

        // Publish an event
        await publisher.publish('event1', { order: 1 })

        // Verify key exists
        const ttl1 = await commander.ttl(key)
        expect(ttl1).toBeGreaterThan(0)
        expect(ttl1).toBeLessThanOrEqual(2) // (2 * retentionSeconds)

        // Wait for key to expire (2 * retentionSeconds = 2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2500))

        // Verify key has been auto-expired by Redis
        const exists = await commander.exists(key)
        expect(exists).toBe(0)
      })
    })
  })

  it('handles multiple subscribers on same event with race condition', { repeats: 3 }, async () => {
    const publisher = createTestingPublisher({
      resumeRetentionSeconds: 10,
    })

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    const [unsub1, unsub2] = await Promise.all([ // race condition
      publisher.subscribe('event1', listener1),
      publisher.subscribe('event1', listener2),
    ])
    const unsub3 = await publisher.subscribe('event1', listener3)

    const payload = { order: 1 }
    await publisher.publish('event1', payload)

    await vi.waitFor(() => {
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener3).toHaveBeenCalledTimes(1)
    })

    expect(listener1).toHaveBeenCalledWith({ order: 1 })
    expect(listener2).toHaveBeenCalledWith({ order: 1 })
    expect(listener3).toHaveBeenCalledWith({ order: 1 })

    await unsub1()

    await publisher.publish('event1', { order: 2 })

    await vi.waitFor(() => {
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(2)
      expect(listener3).toHaveBeenCalledTimes(2)
    })

    expect(listener2).toHaveBeenNthCalledWith(2, { order: 2 })
    expect(listener3).toHaveBeenNthCalledWith(2, { order: 2 })

    await unsub2()
    await unsub3()
  })

  it('handles prefix correctly', async () => {
    const prefix = `custom:${crypto.randomUUID()}:`
    const publisher = createTestingPublisher({
      resumeRetentionSeconds: 10,
      prefix,
    })

    const listener1 = vi.fn()
    const unsub1 = await publisher.subscribe('event1', listener1)

    // verify channel use prefix (NUMSUB is not reliable)
    // await vi.waitFor(async () => {
    //   const numSub = await commander.pubsub('NUMSUB', `${prefix}event1`)
    //   expect(numSub[1]).toBe(1)
    // })

    const payload = { order: 1 }
    await publisher.publish('event1', payload)
    await vi.waitFor(() => {
      expect(listener1).toHaveBeenCalledTimes(1)
    })
    expect(listener1).toHaveBeenCalledWith(expect.objectContaining(payload))

    // Verify the key uses  prefix
    const keys = await commander.keys(`${prefix}*`)
    expect(keys.some(k => k.includes(`${prefix}event1`))).toBe(true)

    await unsub1()
  })

  it('handles serialization with complex objects and custom serializers', async () => {
    class Person {
      constructor(
        public name: string,
        public date: Date,
      ) { }
    }

    const publisher = createTestingPublisher({
      resumeRetentionSeconds: 10,
      customJsonSerializers: [
        {
          condition: data => data instanceof Person,
          type: 20,
          serialize: person => ({ name: person.name, date: person.date }),
          deserialize: data => new Person(data.name, data.date),
        },
      ],
    })

    const listener1 = vi.fn()
    const unsub1 = await publisher.subscribe('event1', listener1)

    const payload = {
      order: 1,
      nested: {
        value: 'test',
        array: [1, 2, 3],
      },
      date: new Date('2024-01-01'),
      person: new Person('John Doe', new Date('2023-01-01')),
    }

    await publisher.publish('event1', payload)

    await vi.waitFor(() => {
      expect(listener1).toHaveBeenCalledTimes(1)
    })
    const received = listener1.mock.calls[0]![0]
    expect(received.order).toBe(1)
    expect(received.nested.value).toBe('test')
    expect(received.nested.array).toEqual([1, 2, 3])
    expect(received.date).toEqual(new Date('2024-01-01'))
    expect(received.person).toEqual(new Person('John Doe', new Date('2023-01-01')))

    await unsub1()
  })

  it('subscribe should throw & on connection error', async () => {
    const invalidListener = new Redis('redis://invalid', {
      maxRetriesPerRequest: 0,
    })

    const publisher = createTestingPublisher({ listener: invalidListener })

    const listener1 = vi.fn()
    const onError1 = vi.fn()
    const listener2 = vi.fn()
    const onError2 = vi.fn()

    await Promise.all([ // race condition
      expect(publisher.subscribe('event1', listener1, { onError: onError1 })).rejects.toThrow(),
      expect(publisher.subscribe('event1', listener1, { onError: onError1 })).rejects.toThrow(),
      expect(publisher.subscribe('event2', listener2, { onError: onError2 })).rejects.toThrow(),
    ])

    expect(listener1).toHaveBeenCalledTimes(0)
    expect(listener2).toHaveBeenCalledTimes(0)
    expect(onError1).toHaveBeenCalledTimes(0) // error happen before register listener
    expect(onError2).toHaveBeenCalledTimes(0) // error happen before register listener
  })

  it('onError should trigger on connection error', async ({ onTestFinished }) => {
    const listener = new Redis(REDIS_URL!, {
      maxRetriesPerRequest: 0,
    })
    onTestFinished(async () => {
      await listener.quit()
    })

    const publisher = createTestingPublisher({ listener })

    const listener1 = vi.fn()
    const onError1 = vi.fn()
    const listener2 = vi.fn()
    const onError2 = vi.fn()

    const unsub1 = await publisher.subscribe('event1', listener1, { onError: onError1 })
    const unsub11 = await publisher.subscribe('event1', listener1, { onError: onError1 })
    const unsub2 = await publisher.subscribe('event2', listener2, { onError: onError2 })

    ;(listener as any).connector.stream.destroy(new Error('Simulated network failure'))

    await vi.waitFor(() => {
      expect(onError1).toHaveBeenCalledTimes(2)
      expect(onError2).toHaveBeenCalledTimes(1)
    })

    await unsub1()
    await unsub11()
    await unsub2()
  })

  describe('edge cases', () => {
    it('handles transaction errors during publish', async () => {
      // Create a mock commander that will fail on multi
      const mockCommander = {
        ...commander,
        multi: () => ({
          xadd: () => ({ xtrim: () => ({ expire: () => ({ exec: async () => [[new Error('Transaction failed')]] }) }) }),
        }),
        publish: commander.publish.bind(commander),
      } as any

      const publisher = createTestingPublisher({
        resumeRetentionSeconds: 10,
        commander: mockCommander,
      })

      // This should throw the transaction error
      await expect(publisher.publish('event1', { order: 1 })).rejects.toThrow('Transaction failed')
    })

    it('only subscribe to redis-listener when needed', async ({ onTestFinished }) => {
      // use dedicated listener
      const listener = new Redis(REDIS_URL!)
      onTestFinished(async () => {
        await listener.quit()
      })

      const publisher = createTestingPublisher({ listener })

      expect(listener.listenerCount('message')).toBe(0)
      expect(listener.listenerCount('error')).toBe(0)

      const listener1 = vi.fn()
      const onError1 = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener1, { onError: onError1 })

      expect(listener.listenerCount('message')).toBe(1)
      expect(listener.listenerCount('error')).toBe(1)

      const onError2 = vi.fn()
      const unsub2 = await publisher.subscribe('event1', listener1, { onError: onError2 })

      expect(listener.listenerCount('message')).toBe(1) // reuse listener
      expect(listener.listenerCount('error')).toBe(1) // reuse onError

      await unsub1()
      expect(listener.listenerCount('message')).toBe(1)
      expect(listener.listenerCount('error')).toBe(1)

      await unsub2()
      expect(listener.listenerCount('message')).toBe(0)
      expect(listener.listenerCount('error')).toBe(0)

      expect(publisher.size).toBe(0)
    })

    it('gracefully handles invalid subscription message', async () => {
      const prefix = `invalid:${crypto.randomUUID()}:`
      const publisher = createTestingPublisher({
        prefix,
      })

      const listener1 = vi.fn()
      const onError1 = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener1, { onError: onError1 })

      // use two onError to ensure redis-onError handle correctly to populate to all onError
      const listener2 = vi.fn()
      const onError2 = vi.fn()
      const unsub2 = await publisher.subscribe('event1', listener2, { onError: onError2 })

      await commander.publish(`${prefix}event1`, 'invalid message')

      await vi.waitFor(() => {
        expect(onError1).toHaveBeenCalledTimes(1)
        expect(onError2).toHaveBeenCalledTimes(1)
      })
      expect(listener1).toHaveBeenCalledTimes(0)
      expect(listener2).toHaveBeenCalledTimes(0)

      await unsub1()
      await unsub2()
    })

    it('support reuse same listener and unsub multiple times', async () => {
      const prefix = `invalid:${crypto.randomUUID()}:`
      const publisher = createTestingPublisher({ prefix })

      const listener = vi.fn()
      const onError = vi.fn()

      const unsub1 = await publisher.subscribe('event1', listener, { onError })
      const unsub2 = await publisher.subscribe('event1', listener, { onError })

      await Promise.all([
        publisher.publish('event1', { order: 1 }),
        commander.publish(`${prefix}event1`, 'invalid message'),
      ])

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(2)
        expect(onError).toHaveBeenCalledTimes(2)
      })

      await unsub1()
      await unsub1()
      await unsub1()

      await Promise.all([
        publisher.publish('event1', { order: 2 }),
        commander.publish(`${prefix}event1`, 'invalid message'),
      ])

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(3)
        expect(onError).toHaveBeenCalledTimes(3)
      })

      await unsub2()
    })
  })
})
