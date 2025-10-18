import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { MemoryPublisher } from './memory'

describe('memoryPublisher', () => {
  it('without resume: can pub/sub but not resume', async () => {
    const publisher = new MemoryPublisher() // resume is disabled by default

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    const unsub1 = await publisher.subscribe('event1', listener1)
    const unsub2 = await publisher.subscribe('event2', listener2)

    const payload1 = { order: 1 }
    const payload2 = { order: 2 }

    publisher.publish('event1', payload1)
    publisher.publish('event3', payload2)

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener1.mock.calls[0]![0]).toBe(payload1) // ensure without proxy
    expect(listener2).toHaveBeenCalledTimes(0)

    await unsub1()

    publisher.publish('event1', payload2)
    publisher.publish('event2', payload2)

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener2.mock.calls[0]![0]).toBe(payload2) // ensure without proxy

    await unsub2()

    const unsub11 = await publisher.subscribe('event1', listener1, { lastEventId: '0' })
    expect(listener1).toHaveBeenCalledTimes(1) // resume not happens
    await unsub11()

    expect(publisher.size).toEqual(0) // ensure no memory leak
  })

  describe('with resume', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('can pub/sub and resume', async () => {
      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 1 })

      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = await publisher.subscribe('event1', listener1)
      const unsub2 = await publisher.subscribe('event2', listener2)

      const payload1 = { order: 1 }
      const payload2 = { order: 2 }

      publisher.publish('event1', payload1)
      publisher.publish('event3', payload2)

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener1).toHaveBeenCalledWith(payload1)
      expect(listener2).toHaveBeenCalledTimes(0)

      await unsub1()

      publisher.publish('event1', payload2)
      publisher.publish('event2', payload2)

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledWith(payload2)

      await unsub2()

      const listener3 = vi.fn()
      const unsub3 = await publisher.subscribe('event1', listener3, { lastEventId: '0' })
      expect(listener3).toHaveBeenCalledTimes(2) // resume happens
      expect(listener3).toHaveBeenNthCalledWith(1, payload1)
      expect(listener3).toHaveBeenNthCalledWith(2, payload2)

      await unsub3()
      expect(publisher.size).toEqual(4) // 4 events are stored
    })

    it('control event.id', async () => {
      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 1 })

      const listener1 = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener1)

      const payload1 = { order: 1 }
      const payload2 = withEventMeta({ order: 2 }, { id: 'some-id', comments: ['hello'] })

      publisher.publish('event1', payload1)
      publisher.publish('event1', payload2)

      expect(listener1).toHaveBeenCalledTimes(2)
      expect(listener1).toHaveBeenNthCalledWith(1, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload1)
        expect(p).toEqual(payload1)
        expect(getEventMeta(p)).toEqual({ id: '1' })
        return true
      }))
      expect(listener1).toHaveBeenNthCalledWith(2, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload2)
        expect(p).toEqual(payload2)
        expect(getEventMeta(p)).toEqual({ id: '2', comments: ['hello'] }) // id is overridden
        return true
      }))

      const listener2 = vi.fn()
      const unsub2 = await publisher.subscribe('event1', listener2, { lastEventId: '0' })
      expect(listener2).toHaveBeenCalledTimes(2)
      expect(listener2).toHaveBeenNthCalledWith(1, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload1)
        expect(p).toEqual(payload1)
        expect(getEventMeta(p)).toEqual({ id: '1' })
        return true
      }))
      expect(listener2).toHaveBeenNthCalledWith(2, expect.toSatisfy((p) => {
        expect(p).not.toBe(payload2)
        expect(p).toEqual(payload2)
        expect(getEventMeta(p)).toEqual({ id: '2', comments: ['hello'] }) // id is overridden
        return true
      }))

      await unsub1()
      await unsub2()
      expect(publisher.size).toEqual(2) // 2 events are stored
    })

    it('resume event.id > lastEventId and in order', async () => {
      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 1 })

      for (let i = 1; i <= 1000; i++) {
        publisher.publish('event', { order: i })
      }

      for (let i = 0; i < 10; i++) {
        const lastEventId = Math.floor(Math.random() * 990)
        const listener1 = vi.fn()
        const unsub = await publisher.subscribe('event', listener1, { lastEventId: lastEventId.toString(36) })
        expect(listener1).toHaveBeenCalledTimes(1000 - lastEventId)
        expect(listener1).toHaveBeenNthCalledWith(1, { order: lastEventId + 1 })
        expect(listener1).toHaveBeenNthCalledWith(2, { order: lastEventId + 2 })
        expect(listener1).toHaveBeenNthCalledWith(10, { order: lastEventId + 10 })
        await unsub()
      }
    })

    it('remove expired events on publish', async () => {
      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 1 })

      publisher.publish('event1', { order: 1 })
      publisher.publish('event2', { order: 2 })
      publisher.publish('event3', { order: 3 })
      publisher.publish('event1', { order: 4 })
      expect(publisher.size).toEqual(4) // 4 events are stored

      vi.advanceTimersByTime(500) // not expired yet
      publisher.publish('event1', { order: 5 })
      expect(publisher.size).toEqual(5) // 5 events are stored

      vi.advanceTimersByTime(500) // expired
      publisher.publish('event2', { order: 6 })
      expect(publisher.size).toEqual(2) // 2 events are stored

      vi.advanceTimersByTime(1000) // expired
      publisher.publish('event10', { order: 7 })
      expect(publisher.size).toEqual(1) // 1 event is stored
    })

    it('support reuse same listener and unsub multiple times', async () => {
      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 1 })

      const listener = vi.fn()
      const unsub1 = await publisher.subscribe('event1', listener)
      const unsub2 = await publisher.subscribe('event1', listener)

      await publisher.publish('event1', { order: 1 })

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(2)
      })

      await unsub1()
      await unsub1()
      await unsub1()

      await publisher.publish('event1', { order: 2 })

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(3)
      })

      await unsub2()
    })
  })
})
