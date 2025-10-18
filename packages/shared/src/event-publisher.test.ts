import { EventPublisher } from './event-publisher'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('eventPublisher', () => {
  const pub = new EventPublisher()

  afterEach(() => {
    expect(pub.size).toBe(0)
  })

  describe('listener consumer', () => {
    let listener1: any
    let listener2: any
    let listener3: any

    let unsub1: any
    let unsub2: any
    let unsub3: any

    beforeEach(() => {
      listener1 = vi.fn()
      listener2 = vi.fn()
      listener3 = vi.fn()

      unsub1 = pub.subscribe('event', listener1)
      unsub2 = pub.subscribe('event', listener2)
      unsub3 = pub.subscribe('event3', listener3)
    })

    afterEach(() => {
      unsub1()
      unsub2()
      unsub3()
    })

    it('do nothing if no listeners', () => {
      pub.publish('unique1', 'payload')
      pub.publish('unique2', 'payload')
      pub.publish('unique3', 'payload')

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
      expect(listener3).not.toHaveBeenCalled()
    })

    it('invoke correct listeners', () => {
      pub.publish('event', 'payload1')

      expect(listener1).toHaveBeenCalledWith('payload1')
      expect(listener1).toBeCalledTimes(1)
      expect(listener2).toHaveBeenCalledWith('payload1')
      expect(listener2).toBeCalledTimes(1)
      expect(listener3).toBeCalledTimes(0)

      pub.publish('event3', 'payload2')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener3).toHaveBeenCalledWith('payload2')
      expect(listener3).toBeCalledTimes(1)

      unsub1()

      pub.publish('event', 'payload3')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(2)
      expect(listener2).toHaveBeenNthCalledWith(2, 'payload3')
      expect(listener3).toHaveBeenCalledTimes(1)

      pub.publish('event3', 'payload4')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(2)
      expect(listener3).toHaveBeenCalledTimes(2)
      expect(listener3).toHaveBeenNthCalledWith(2, 'payload4')
    })
  })

  describe('async iterator consumer', () => {
    let controller3: AbortController
    let iterator1: any
    let iterator2: any
    let iterator3: any

    beforeEach(() => {
      controller3 = new AbortController()
      iterator1 = pub.subscribe('event')
      iterator2 = pub.subscribe('event', { maxBufferedEvents: 1 })
      iterator3 = pub.subscribe('event3', { signal: controller3.signal })
    })

    afterEach(async () => {
      await iterator1.return()
      await iterator2.return()
      await iterator3.return()
    })

    it('do nothing if no listeners', async () => {
      const payloads: any[] = []

        ; (async () => {
        for await (const payload of iterator1) {
          payloads.push(payload)
        }
      })()

      ; (async () => {
        for await (const payload of iterator2) {
          payloads.push(payload)
        }
      })()

      ; (async () => {
        for await (const payload of iterator3) {
          payloads.push(payload)
        }
      })()

      pub.publish('unique1', 'payload')
      pub.publish('unique2', 'payload')
      pub.publish('unique3', 'payload')

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(payloads).toEqual([])
    })

    it('invoke correct listeners', async () => {
      const payloads1: any[] = []
      const payloads2: any[] = []
      const payloads3: any[] = []

      ;(async () => {
        for await (const payload of iterator1) {
          payloads1.push(payload)
        }
      })()

      ;(async () => {
        for await (const payload of iterator2) {
          payloads2.push(payload)
        }
      })()

      ;(async () => {
        for await (const payload of iterator3) {
          payloads3.push(payload)
        }
      })()

      pub.publish('event', 'payload1')

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payloads1).toEqual(['payload1'])
      expect(payloads2).toEqual(['payload1'])
      expect(payloads3).toEqual([])

      pub.publish('event3', 'payload2')

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payloads1).toEqual(['payload1'])
      expect(payloads2).toEqual(['payload1'])
      expect(payloads3).toEqual(['payload2'])

      await iterator1.return()

      pub.publish('event', 'payload3')

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payloads1).toEqual(['payload1'])
      expect(payloads2).toEqual(['payload1', 'payload3'])
      expect(payloads3).toEqual(['payload2'])

      pub.publish('event3', 'payload4')

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payloads1).toEqual(['payload1'])
      expect(payloads2).toEqual(['payload1', 'payload3'])
      expect(payloads3).toEqual(['payload2', 'payload4'])
    })

    it('exceeds maxBufferedEvents', async () => {
      for (let i = 0; i < 200; i++) {
        pub.publish('event', i)
      }

      const payload1: any[] = []
      const payload2: any[] = []

      ;(async () => {
        for await (const payload of iterator1) {
          payload1.push(payload)
        }
      })()

      ;(async () => {
        for await (const payload of iterator2) {
          payload2.push(payload)
        }
      })()

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payload1).toEqual(Array.from({ length: 100 }, (_, i) => i + 100))
      expect(payload2).toEqual([199])
    })

    it('auto unsubscribe if error thrown inside for...await', async () => {
      const payloads: any[] = []

      const promise = expect((async () => {
        for await (const payload of iterator1) {
          if (payload === 'error') {
            throw new Error('error')
          }
          payloads.push(payload)
        }
      })()).rejects.toThrow('error')

      pub.publish('event', 'payload1')
      pub.publish('event', 'payload2')
      pub.publish('event', 'error')
      pub.publish('event', 'payload3')

      await new Promise(resolve => setTimeout(resolve, 1))

      expect(payloads).toEqual(['payload1', 'payload2'])

      await promise

      expect(pub.size).toEqual(2) // iterator1 was unsubscribed
    })

    it('throw immediately if signal aborted', () => {
      controller3.abort()
      const payloads: any[] = []

      expect(() => pub.subscribe('event3', { signal: controller3.signal })).toThrow(controller3.signal.reason)
    })

    it('throw if signal aborted while awaiting next', async () => {
      const payloads: any[] = []

      const promise = expect(async () => {
        for await (const payload of iterator3) {
          payloads.push(payload)
        }
      },
      ).rejects.toThrow(controller3.signal.reason)

      pub.publish('event3', 'payload1')
      await new Promise(resolve => setTimeout(resolve, 1))
      controller3.abort()
      pub.publish('event3', 'payload2')

      expect(payloads).toEqual(['payload1'])

      await promise
    })

    it('support reuse lister for multiple time', async () => {
      const listener = vi.fn()

      const unsub1 = pub.subscribe('event', listener)
      const unsub2 = pub.subscribe('event', listener)

      pub.publish('event', 'payload1')
      expect(listener).toHaveBeenCalledTimes(2)

      unsub1()
      pub.publish('event', 'payload2')
      expect(listener).toHaveBeenCalledTimes(3)

      unsub2()
    })

    it('safely unsub multiple times', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = pub.subscribe('event', listener1)
      const unsub2 = pub.subscribe('event', listener2)

      unsub1()
      unsub1()
      unsub1()

      pub.publish('event', 'payload1')
      expect(listener1).toHaveBeenCalledTimes(0)
      expect(listener2).toHaveBeenCalledTimes(1)

      unsub2()
    })
  })
})
