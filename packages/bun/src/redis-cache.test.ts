import { RPCSerializer } from '@orpc/client'
import { nowInSeconds, sleep } from '@orpc/shared'
import { RedisClient } from 'bun'
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { holdResult, waitFor } from '../tests/__shared__/utils'
import { BunRedisCacheStore } from './redis-cache'

const REDIS_URL = Bun.env.REDIS_URL

describe.skipIf(!REDIS_URL)('bun redis cache store integration', () => {
  const redis = new RedisClient(REDIS_URL)

  beforeAll(async () => {
    await redis.connect()
  })

  afterAll(() => {
    redis.close()
  })

  function createTestingStore(
    options: ConstructorParameters<typeof BunRedisCacheStore>[1] = {},
    client: RedisClient = redis,
  ) {
    const prefix = `orpc-bun-redis-cache-store-${crypto.randomUUID()}:`
    return { store: new BunRedisCacheStore(client, { prefix, ...options }), prefix }
  }

  it('round-trips outputs with their tags and expiresAt, including undefined', async () => {
    const { store } = createTestingStore()

    await store.set('k', { nested: [1, 2] }, { tags: ['t'], ttl: 120 })

    const entry = await store.get('k')
    expect(entry!.output).toEqual({ nested: [1, 2] })
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(nowInSeconds())

    await store.set('u', undefined)
    await expect(store.get('u')).resolves.toEqual({ output: undefined, tags: undefined, expiresAt: undefined })
    await expect(store.get('unknown')).resolves.toBeUndefined()
  })

  it('preserves Date, Map, Set, and BigInt outputs', async () => {
    const { store } = createTestingStore()
    const output = {
      date: new Date('2026-01-02T03:04:05.678Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      big: 123n,
    }

    await store.set('k', output)
    await expect(store.get('k')).resolves.toMatchObject({ output })
  })

  it('invalidates entries by any of their tags, and keeps ones set afterwards', async () => {
    const { store } = createTestingStore()

    await store.set('multi', 'v', { tags: ['a', 'b'] })
    await store.set('other', 'v', { tags: ['c'] })

    await store.revalidate({ tags: ['a', 'b'] })

    await expect(store.get('multi')).resolves.toBeUndefined()
    await expect(store.get('other')).resolves.toBeDefined()

    await store.set('multi', 'new', { tags: ['a'] })
    await expect(store.get('multi')).resolves.toMatchObject({ output: 'new' })
  })

  it('supports a custom serializer', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = spyOn(serializer, 'serialize')
    const deserializeSpy = spyOn(serializer, 'deserialize')
    const { store } = createTestingStore({ serializer })

    await store.set('k', { a: 1 })

    await expect(store.get('k')).resolves.toMatchObject({ output: { a: 1 } })
    expect(serializeSpy).toHaveBeenCalled()
    expect(deserializeSpy).toHaveBeenCalled()
  })

  it('evicts at ttl without swr, and serves stale within the swr window', async () => {
    const { store } = createTestingStore()

    await store.set('no-swr', 'v', { ttl: 1 })
    await store.set('swr', 'v', { ttl: 1, swr: 10 })

    await sleep(1500)

    await expect(store.get('no-swr')).resolves.toBeUndefined()

    const stale = await store.get('swr')
    expect(stale!.output).toBe('v')
    expect(stale!.expiresAt).toBeLessThanOrEqual(nowInSeconds())
  }, { timeout: 20_000 })

  it('stores entries and tag counters under the prefixed key families, defaulting to no prefix', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(redis.exists(`${prefix}e:k`)).resolves.toBe(true)
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(true)

    const unprefixed = new BunRedisCacheStore(redis)
    const key = crypto.randomUUID()

    await unprefixed.set(key, 'v')

    await expect(redis.exists(`e:${key}`)).resolves.toBe(true)
    await expect(unprefixed.get(key)).resolves.toMatchObject({ output: 'v' })
  })

  it('treats tags missing from the snapshot as version zero', async () => {
    const { store, prefix } = createTestingStore()

    await redis.set(`${prefix}e:k`, JSON.stringify({ output: { json: 'v' }, tags: ['t'], tagVersions: {} }))

    await expect(store.get('k')).resolves.toMatchObject({ output: 'v' })
  })

  it('encodes non-string keys stably', async () => {
    const { store } = createTestingStore()

    await store.set([['planet', 'find'], { b: 2, a: 1 }], 'v')

    await expect(store.get([['planet', 'find'], { a: 1, b: 2 }])).resolves.toMatchObject({ output: 'v' })
    await expect(store.get([['planet', 'find'], { a: 1, b: 3 }])).resolves.toBeUndefined()
  })

  it('drops an entry whose tag versions were read before a racing revalidation', async () => {
    const { client, read, release } = holdResult(redis, 'mget')
    const { store, prefix } = createTestingStore({}, client)

    const set = store.set('k', 'v', { tags: ['t'] }) // entry written after release
    await read // versions are read by now
    await store.revalidate({ tags: ['t'] })
    release()
    await set

    await expect(store.get('k')).resolves.toBeUndefined()
    await expect(redis.exists(`${prefix}e:k`)).resolves.toBe(false)
  })

  it('stays consistent under concurrent sets, gets, and a revalidation on a shared tag', async () => {
    const { store } = createTestingStore()
    const keys = Array.from({ length: 20 }, (_, index) => `k${index}`)

    await Promise.all([
      ...keys.map(key => store.set(key, key, { tags: ['t'] })),
      store.revalidate({ tags: ['t'] }),
      ...keys.map(key => store.get(key)),
    ])

    // Entries snapshotted before the revalidation miss, the rest hit with their own output.
    const entries = await Promise.all(keys.map(key => store.get(key)))
    entries.forEach((entry, index) => {
      if (entry !== undefined) {
        expect(entry.output).toBe(keys[index])
      }
    })

    await store.revalidate({ tags: ['t'] })

    await expect(Promise.all(keys.map(key => store.get(key)))).resolves.toEqual(keys.map(() => undefined))
  })

  it('runs lock callbacks one key at a time, handing on after failures', async () => {
    const { store } = createTestingStore()
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = store.lock('k', async (waited) => {
      order.push(`first:${waited}`)
      await held
      return 'first'
    })
    await waitFor(() => expect(order).toEqual(['first:false']), { timeout: 5000 })

    const second = store.lock('k', async (waited) => {
      order.push(`second:${waited}`)
      return 'second'
    })
    await expect(store.lock('other', async waited => waited)).resolves.toBe(false)
    expect(order).toEqual(['first:false'])

    release()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first:false', 'second:true'])

    await expect(store.lock('k', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    await expect(store.lock('k', async waited => waited)).resolves.toBe(false)
  })

  it('frees waiters after lockTtl and leaves a lock taken over that way alone', async () => {
    const { store, prefix } = createTestingStore({ lockTtl: 1 })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let takenOver!: () => void
    const takeover = new Promise<void>((resolve) => {
      takenOver = resolve
    })

    // Holds past its ttl, until the waiter has taken the lock over.
    const holder = store.lock('k', () => takeover)
    await waitFor(async () => expect(await redis.exists(`${prefix}l:k`)).toBe(true), { timeout: 5000 })

    const waiter = store.lock('k', async (waited) => {
      takenOver()
      await held
      return waited
    })

    await holder
    // The holder's release must leave the waiter's lock alone.
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(true)

    release()
    await expect(waiter).resolves.toBe(true)
    await expect(redis.exists(`${prefix}l:k`)).resolves.toBe(false)
  }, { timeout: 20_000 })
})
