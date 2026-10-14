import { getEventMeta, withEventMeta } from '@standard-server/core'
import { MemoryPublisher } from './memory'

type TestEvents = {
  message: { text: string }
  notice: { text: string }
}

async function delayMicrotasks(count: number): Promise<void> {
  for (let i = 0; i <= count; i++) {
    await Promise.resolve()
  }
}

describe('memoryPublisher', () => {
  it('delivers live events without resume when resume is disabled', async () => {
    const publisher = new MemoryPublisher<TestEvents>()
    const listener = vi.fn()

    const unsubscribe = await publisher.subscribe('message', listener)
    const payload = { text: 'live event' }

    await publisher.publish('notice', { text: 'ignored event' })
    await publisher.publish('message', payload)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(payload)
    expect(listener.mock.calls[0]![0]).toBe(payload)

    await unsubscribe()

    const resumed = vi.fn()
    const unsubscribeResumed = await publisher.subscribe('message', resumed, { lastEventId: '0' })

    expect(resumed).not.toHaveBeenCalled()

    await unsubscribeResumed()
  })

  describe('with resume enabled', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resumes only events after lastEventId and rewrites event ids', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: {
          enabled: true,
        },
      })

      const liveListener = vi.fn()
      const unsubscribeLive = await publisher.subscribe('message', liveListener)

      const firstPayload = { text: 'first' }
      const secondPayload = withEventMeta({ text: 'second' }, { id: 'client-id' })
      const thirdPayload = { text: 'third' }

      await publisher.publish('message', firstPayload)
      await publisher.publish('message', secondPayload)
      await publisher.publish('message', thirdPayload)

      expect(liveListener).toHaveBeenCalledTimes(3)

      const firstDelivered = liveListener.mock.calls[0]![0]
      const secondDelivered = liveListener.mock.calls[1]![0]
      const thirdDelivered = liveListener.mock.calls[2]![0]

      expect(firstDelivered).toEqual(firstPayload)
      expect(firstDelivered).not.toBe(firstPayload)
      expect(getEventMeta(firstDelivered)?.id).toBe('1')

      expect(secondDelivered).toEqual(secondPayload)
      expect(secondDelivered).not.toBe(secondPayload)
      expect(getEventMeta(secondDelivered)?.id).toBe('2')

      expect(thirdDelivered).toEqual(thirdPayload)
      expect(getEventMeta(thirdDelivered)?.id).toBe('3')

      const resumed = vi.fn()
      const unsubscribeResume = await publisher.subscribe('message', resumed, {
        lastEventId: getEventMeta(secondDelivered)?.id,
      })

      expect(resumed).toHaveBeenCalledTimes(1)
      expect(resumed).toHaveBeenCalledWith(thirdDelivered)

      const emptyResume = vi.fn()
      const unsubscribeEmptyResume = await publisher.subscribe('notice', emptyResume, {
        lastEventId: '0',
      })

      expect(emptyResume).not.toHaveBeenCalled()

      const afterTail = vi.fn()
      const unsubscribeAfterTail = await publisher.subscribe('message', afterTail, {
        lastEventId: getEventMeta(thirdDelivered)?.id,
      })

      expect(afterTail).not.toHaveBeenCalled()

      await unsubscribeLive()
      await unsubscribeResume()
      await unsubscribeEmptyResume()
      await unsubscribeAfterTail()
    })

    it('expires old events lazily for AsyncIteratorObject subscribers', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: {
          enabled: true,
          seconds: 1,
        },
      })

      await publisher.publish('message', { text: 'stale message' })
      await publisher.publish('notice', { text: 'stale notice' })

      vi.advanceTimersByTime(500)

      await publisher.publish('notice', { text: 'fresh notice' })

      const beforeExpiry = publisher.subscribe('notice', { lastEventId: '0' })

      expect((await beforeExpiry.next()).value?.text).toBe('stale notice')
      expect((await beforeExpiry.next()).value?.text).toBe('fresh notice')

      await beforeExpiry.return()

      vi.advanceTimersByTime(500)

      await publisher.publish('message', { text: 'fresh message' })

      const messageIterator = publisher.subscribe('message', { lastEventId: '0' })
      const noticeIterator = publisher.subscribe('notice', { lastEventId: '0' })

      expect((await messageIterator.next()).value?.text).toBe('fresh message')
      expect((await noticeIterator.next()).value?.text).toBe('fresh notice')

      await messageIterator.return()
      await noticeIterator.return()
    })

    it('resumes every missed event for AsyncIteratorObject subscribers beyond maxBufferedEvents', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        maxBufferedEvents: 1,
        resume: {
          enabled: true,
        },
      })

      for (let i = 0; i < 3; i++) {
        await publisher.publish('message', { text: `${i}` })
      }

      const iterator = publisher.subscribe('message', { lastEventId: '0' })

      for (let i = 0; i < 3; i++) {
        expect((await iterator.next()).value?.text).toBe(`${i}`)
      }

      await iterator.return()
    })

    it('stays consistent under heavy interleaving of publishes and repeated unsubscriptions', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: {
          enabled: true,
          seconds: 1,
        },
      })

      const listener = vi.fn()
      const unsubscribeFns = await Promise.all(
        Array.from({ length: 50 }, () => publisher.subscribe('message', listener)),
      )

      const operations: Promise<void>[] = []
      let expectedCalls = 0
      let activeRegistrations = unsubscribeFns.length

      unsubscribeFns.forEach((unsubscribe, index) => {
        operations.push((async () => {
          await delayMicrotasks(index * 2)
          await publisher.publish('message', { text: `burst-${index}` })
        })())

        expectedCalls += activeRegistrations
        activeRegistrations -= 1

        operations.push((async () => {
          await delayMicrotasks(index * 2 + 1)
          await Promise.all([unsubscribe(), unsubscribe(), unsubscribe(), unsubscribe()])
        })())
      })

      await Promise.all(operations)

      expect(listener).toHaveBeenCalledTimes(expectedCalls)

      await publisher.publish('message', { text: 'after-race' })

      expect(listener).toHaveBeenCalledTimes(expectedCalls)

      const probe = vi.fn()
      const unsubscribeProbe = await publisher.subscribe('message', probe)

      await publisher.publish('message', { text: 'probe' })

      expect(listener).toHaveBeenCalledTimes(expectedCalls)
      expect(probe).toHaveBeenCalledTimes(1)

      await unsubscribeProbe()
    })
  })

  describe('resume replay is bounded for untrusted lastEventId', () => {
    it('keeps at most maxReplayedEvents of the newest missed events', async () => {
      const publisher = new MemoryPublisher<{ e: { n: number } }>({
        resume: { enabled: true },
        maxBufferedEvents: 10,
        maxReplayedEvents: 50,
      })

      for (let i = 0; i < 2000; i++) {
        await publisher.publish('e', { n: i })
      }

      // Any client can send `last-event-id: 0` to request the whole retention window.
      const iterator = publisher.subscribe('e', { lastEventId: '0' })
      await new Promise(resolve => setTimeout(resolve, 0))
      await publisher.publish('e', { n: -1 }) // sentinel

      const received: number[] = []
      while (true) {
        const { value } = await iterator.next()
        if (value!.n === -1)
          break
        received.push(value!.n)
      }
      await iterator.return()

      // newest missed events kept, oldest dropped
      expect(received).toEqual(Array.from({ length: 50 }, (_, i) => 1950 + i))
    })

    it('bounds the replay for callback subscribers, which can override the publisher limit', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: { enabled: true },
        maxReplayedEvents: 2,
      })

      for (let i = 0; i < 5; i++) {
        await publisher.publish('message', { text: `${i}` })
      }

      const replayed = async (options: { maxReplayedEvents?: number }) => {
        const listener = vi.fn()
        const unsubscribe = await publisher.subscribe('message', listener, { lastEventId: '0', ...options })
        await unsubscribe()
        return listener.mock.calls.map(([payload]) => payload.text)
      }

      expect(await replayed({})).toEqual(['3', '4'])
      expect(await replayed({ maxReplayedEvents: 3 })).toEqual(['2', '3', '4'])
      expect(await replayed({ maxReplayedEvents: Infinity })).toEqual(['0', '1', '2', '3', '4'])
      expect(await replayed({ maxReplayedEvents: 0 })).toEqual([])
    })

    it('replays at most 1000 missed events by default', async () => {
      const publisher = new MemoryPublisher<TestEvents>({ resume: { enabled: true } })

      for (let i = 0; i < 1005; i++) {
        await publisher.publish('message', { text: `${i}` })
      }

      const listener = vi.fn()
      const unsubscribe = await publisher.subscribe('message', listener, { lastEventId: '0' })

      expect(listener).toHaveBeenCalledTimes(1000)
      expect(listener.mock.calls[0]![0].text).toBe('5')
      expect(listener.mock.calls[999]![0].text).toBe('1004')

      await unsubscribe()
    })
  })

  describe('edge cases', () => {
    it('allows the same listener to be registered multiple times', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: {
          enabled: true,
          seconds: 1,
        },
      })

      const listener = vi.fn()
      const unsubscribeFirst = await publisher.subscribe('message', listener)
      const unsubscribeSecond = await publisher.subscribe('message', listener)
      const unsubscribeThird = await publisher.subscribe('message', listener)

      await publisher.publish('message', { text: 'first' })

      expect(listener).toHaveBeenCalledTimes(3)

      await unsubscribeSecond()

      await publisher.publish('message', { text: 'second' })

      expect(listener).toHaveBeenCalledTimes(5)

      await unsubscribeFirst()
      await unsubscribeThird()

      await publisher.publish('message', { text: 'third' })

      expect(listener).toHaveBeenCalledTimes(5)
    })

    it('lets each unsubscribe function be called multiple times safely', async () => {
      const publisher = new MemoryPublisher<TestEvents>({
        resume: {
          enabled: true,
          seconds: 1,
        },
      })

      const listener1 = vi.fn()
      const unsub1 = await publisher.subscribe('message', listener1)

      const listener2 = vi.fn()
      const unsub2 = await publisher.subscribe('message', listener2)

      await publisher.publish('message', { text: 'first' })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)

      await Promise.all(Array.from({ length: 10 }, () => unsub1()))

      await publisher.publish('message', { text: 'second' })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(2)

      await unsub2()
    })

    it('delivers to every listener even when one unsubscribes itself while receiving', async () => {
      const publisher = new MemoryPublisher<TestEvents>()

      let unsubscribeFirst: () => Promise<void>
      const first = vi.fn(() => {
        void unsubscribeFirst()
      })
      const second = vi.fn()

      unsubscribeFirst = await publisher.subscribe('message', first)
      const unsubscribeSecond = await publisher.subscribe('message', second)

      await publisher.publish('message', { text: 'first' })

      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)

      await publisher.publish('message', { text: 'second' })

      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(2)

      await unsubscribeSecond()
    })
  })
})
