import { RPCJsonSerializer } from '@orpc/client'
import { BentoCache, bentostore } from 'bentocache'
import { memoryDriver } from 'bentocache/drivers/memory'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { BentoCacheStore } from './bentocache'

describe('bentoCacheStore', () => {
  function createBento() {
    return new BentoCache({
      default: 'memory',
      stores: {
        memory: bentostore().useL1Layer(memoryDriver()),
      },
    })
  }

  describeCacheStoreContract(() => new BentoCacheStore(createBento()))

  it('keeps namespaces apart', async () => {
    const bento = createBento()
    const first = new BentoCacheStore(bento.namespace('first'))
    const second = new BentoCacheStore(bento.namespace('second'))

    await first.getOrSet('k', async () => 'first')

    await expect(second.getOrSet('k', async () => 'second')).resolves.toMatchObject({ output: 'second' })
    await expect(first.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: 'first' })
  })

  it('maps ttl and swr to a BentoCache ttl and grace in milliseconds, and no ttl to getOrSetForever', async () => {
    const bento = createBento()
    const getOrSet = vi.spyOn(bento, 'getOrSet')
    const getOrSetForever = vi.spyOn(bento, 'getOrSetForever')
    const store = new BentoCacheStore(bento)

    await expect(store.getOrSet('k', async () => 'v', { tags: ['t'], ttl: 1, swr: 1 })).resolves.toMatchObject({ tags: ['t'], expiresAt: expect.any(Number), evictAt: expect.any(Number) })
    expect(getOrSet).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', ttl: 1000, grace: 1000, tags: ['t'] }))

    await expect(store.getOrSet('forever', async () => 'v')).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: undefined, evictAt: undefined })
    expect(getOrSetForever).toHaveBeenCalledWith(expect.objectContaining({ key: 'forever', grace: false }))
    expect(getOrSetForever).not.toHaveBeenCalledWith(expect.objectContaining({ ttl: expect.anything() }))
  })

  describe('with a frozen clock', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(0)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('serves stale entries within the swr window while BentoCache refreshes them, handing a failed refresh to waitUntil', async () => {
      const store = new BentoCacheStore(createBento())

      await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

      vi.setSystemTime(1200) // past ttl, within swr
      const waitUntil = vi.fn()
      await expect(store.getOrSet('k', async () => {
        throw new Error('handler down')
      }, { ttl: 1, swr: 1, waitUntil })).resolves.toEqual({ output: 'v', tags: undefined, expiresAt: 1, evictAt: 2 })
      await vi.waitFor(() => expect(waitUntil).toHaveBeenCalledTimes(1))
      await expect(waitUntil.mock.calls[0]![0]).rejects.toThrow('handler down')

      await store.getOrSet('k', async () => 'fresh', { ttl: 1, swr: 1 })
      await vi.waitFor(() => expect(store.getOrSet('k', async () => 'other', { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'fresh', expiresAt: 2, evictAt: 3 }))
    })

    it('leaves a failed refresh unhandled without waitUntil', async ({ onTestFinished }) => {
      // Vitest reports unhandled rejections as failures, so its listeners step aside for this test.
      const listeners = process.rawListeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[]
      process.removeAllListeners('unhandledRejection')
      const unhandledRejectionHandler = vi.fn()
      process.on('unhandledRejection', unhandledRejectionHandler)
      onTestFinished(() => {
        process.off('unhandledRejection', unhandledRejectionHandler)
        for (const listener of listeners) {
          process.on('unhandledRejection', listener)
        }
      })
      const store = new BentoCacheStore(createBento())

      await store.getOrSet('k', async () => 'v', { ttl: 1, swr: 1 })

      vi.setSystemTime(1200)
      await expect(store.getOrSet('k', async () => {
        throw new Error('handler down')
      }, { ttl: 1, swr: 1 })).resolves.toMatchObject({ output: 'v' })

      await vi.waitFor(() => expect(unhandledRejectionHandler).toHaveBeenCalledWith(new Error('handler down'), expect.any(Promise)))
    })
  })

  it('serves a revalidated entry once more with swr, then the refreshed one', async () => {
    const store = new BentoCacheStore(createBento())

    await store.getOrSet('k', async () => 'old', { tags: ['t'], ttl: 60, swr: 60 })
    await store.revalidate({ tags: ['t'] })

    await expect(store.getOrSet('k', async () => 'new', { tags: ['t'], ttl: 60, swr: 60 })).resolves.toMatchObject({ output: 'old' })
    await vi.waitFor(() => expect(store.getOrSet('k', async () => 'newer', { tags: ['t'], ttl: 60, swr: 60 })).resolves.toMatchObject({ output: 'new' }))
  })

  it('rethrows fill errors bare, and BentoCache errors as they are', async () => {
    const bento = createBento()
    const store = new BentoCacheStore(bento)

    await expect(store.getOrSet('k', async () => {
      throw new Error('handler down')
    })).rejects.toThrow('handler down')

    vi.spyOn(bento, 'getOrSet').mockRejectedValueOnce(new Error('bento down'))
    await expect(store.getOrSet('k', async () => 'v', { ttl: 1 })).rejects.toThrow('bento down')
  })

  it('revalidates through deleteByTag', async () => {
    const bento = createBento()
    const deleteByTag = vi.spyOn(bento, 'deleteByTag')
    const store = new BentoCacheStore(bento)

    await store.revalidate({ tags: ['a', 'b'] })

    expect(deleteByTag).toHaveBeenCalledWith({ tags: ['a', 'b'] })
  })

  it('supports a custom serializer', async () => {
    const serializer = new RPCJsonSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
    const store = new BentoCacheStore(createBento(), { serializer })

    await store.getOrSet('k', async () => ({ date: new Date(1) }))

    await expect(store.getOrSet('k', async () => 'other')).resolves.toMatchObject({ output: { date: new Date(1) } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })
})
