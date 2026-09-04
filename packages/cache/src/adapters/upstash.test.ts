import { RPCSerializer } from '@orpc/client'
import { nowInSeconds, sleep } from '@orpc/shared'
import { Redis } from '@upstash/redis'
import { describeCacheStoreContract } from '../../tests/__shared__/store-contract'
import { holdResult } from '../../tests/__shared__/utils'
import { UpstashCacheStore } from './upstash'

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests depend on a real Upstash redis server — make sure to set the
 * `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` envs.
 */
describe.concurrent('upstash cache store integration', {
  // TODO: Upstash is not compatible with Node 26 yet — temporarily disable these tests and revisit in the future.
  skip: !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN || process.versions.node.startsWith('26.'),
  timeout: 20_000,
}, () => {
  const redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  })

  function createTestingStore(
    options: ConstructorParameters<typeof UpstashCacheStore>[1] = {},
    client: Redis = redis,
  ) {
    const prefix = `orpc-upstash-cache-store-${crypto.randomUUID()}:`
    return { store: new UpstashCacheStore(client, { prefix, ...options }), prefix }
  }

  describeCacheStoreContract(() => createTestingStore().store)

  it('supports a custom serializer', async () => {
    const serializer = new RPCSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serialize')
    const deserializeSpy = vi.spyOn(serializer, 'deserialize')
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
  })

  it('stores entries and tag counters under the prefixed key families, defaulting to no prefix', async () => {
    const { store, prefix } = createTestingStore()

    await store.set('k', 'v', { tags: ['t'] })
    await store.revalidate({ tags: ['t'] })

    await expect(redis.exists(`${prefix}e:k`)).resolves.toBe(1)
    await expect(redis.exists(`${prefix}t:t`)).resolves.toBe(1)

    const unprefixed = new UpstashCacheStore(redis)
    const key = crypto.randomUUID()

    await unprefixed.set(key, 'v')

    await expect(redis.exists(`e:${key}`)).resolves.toBe(1)
    await expect(unprefixed.get(key)).resolves.toMatchObject({ output: 'v' })
  })

  it('reads envelopes when the client does not parse JSON responses', async () => {
    const rawRedis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: false,
    })
    const { store } = createTestingStore({}, rawRedis)

    await store.set('k', { a: 1 }, { tags: ['t'], ttl: 60 })

    const entry = await store.get('k')
    expect(entry!.output).toEqual({ a: 1 })
    expect(entry!.tags).toEqual(['t'])
    expect(entry!.expiresAt).toBeGreaterThan(nowInSeconds())

    await store.revalidate({ tags: ['t'] })
    await expect(store.get('k')).resolves.toBeUndefined()
  })

  it('treats tags missing from the snapshot as version zero', async () => {
    const { store, prefix } = createTestingStore()

    await redis.set(`${prefix}e:k`, JSON.stringify({ output: { json: 'v' }, tags: ['t'], tagVersions: {} }))

    await expect(store.get('k')).resolves.toMatchObject({ output: 'v' })
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
    await expect(redis.exists(`${prefix}e:k`)).resolves.toBe(0)
  })
})
