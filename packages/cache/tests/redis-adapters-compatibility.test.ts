import type { CacheStore } from '../src'
import { nowInSeconds, sleep } from '@orpc/shared'
import { Redis } from '@upstash/redis'
import { createClient } from 'redis'
import { RedisCacheStore } from '../src/adapters/redis'
import { UpstashCacheStore } from '../src/adapters/upstash'

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests require a real Upstash Redis server.
 * Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` before running them.
 *
 * When adding new tests, always use unique keys to avoid conflicts with other cases.
 *
 * All adapters must connect to the same server.
 */
describe.concurrent('cache redis adapters compatibility', { timeout: 20_000 }, () => {
  const stores: Array<{ name: string, store: CacheStore }> = []
  const prefix = `redis-adapters:${crypto.randomUUID()}:`

  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    const redis = createClient({ url: `rediss://default:${UPSTASH_REDIS_REST_TOKEN}@${new URL(UPSTASH_REDIS_REST_URL).host}:6379` })

    afterAll(() => {
      redis.close()
    })

    stores.push({ name: 'redis', store: new RedisCacheStore(redis, { prefix }) })
  }

  // TODO: Upstash is not compatible with Node 26 yet — temporarily disable these tests and revisit in the future.
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN && !process.versions.node.startsWith('26.')) {
    const upstashRedis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })

    stores.push({ name: 'upstash', store: new UpstashCacheStore(upstashRedis, { prefix }) })
  }

  describe.skipIf(stores.length < 2)('cross-adapter compatibility', () => {
    for (const source of stores) {
      for (const target of stores) {
        if (source === target) {
          continue
        }

        it(`shares entries and revalidations: ${source.name} → ${target.name}`, async () => {
          const id = crypto.randomUUID()
          const tag = `tag:${crypto.randomUUID()}`
          const output = { date: new Date('2026-01-02T03:04:05.678Z'), big: 123n }

          await source.store.set([['planet', 'find'], { b: 2, id }], output, { tags: [tag], ttl: 60 })

          // Structurally equal keys resolve the same entry across adapters, whatever the property order.
          const entry = await target.store.get([['planet', 'find'], { id, b: 2 }])
          expect(entry!.output).toEqual(output)
          expect(entry!.tags).toEqual([tag])
          expect(entry!.expiresAt).toBeGreaterThan(nowInSeconds())

          await target.store.revalidate({ tags: [tag] })

          await expect(source.store.get([['planet', 'find'], { b: 2, id }])).resolves.toBeUndefined()
        })

        it(`shares tag counters: ${source.name} → ${target.name}`, async () => {
          const key = `counter:${crypto.randomUUID()}`
          const tag = `tag:${crypto.randomUUID()}`

          await source.store.set(key, 'v1', { tags: [tag] })
          await target.store.revalidate({ tags: [tag] })
          await expect(source.store.get(key)).resolves.toBeUndefined()

          // A snapshot taken by one adapter stays valid for the other until the next revalidation.
          await target.store.set(key, 'v2', { tags: [tag] })
          await expect(source.store.get(key)).resolves.toMatchObject({ output: 'v2' })

          await source.store.revalidate({ tags: [tag] })
          await expect(target.store.get(key)).resolves.toBeUndefined()
        })

        it(`shares retention: ${source.name} → ${target.name}`, async () => {
          const noSwr = `no-swr:${crypto.randomUUID()}`
          const swr = `swr:${crypto.randomUUID()}`

          await source.store.set(noSwr, 'v', { ttl: 1 })
          await source.store.set(swr, 'v', { ttl: 1, swr: 10 })

          await sleep(1500)

          await expect(target.store.get(noSwr)).resolves.toBeUndefined()

          const stale = await target.store.get(swr)
          expect(stale!.output).toBe('v')
          expect(stale!.expiresAt).toBeLessThanOrEqual(nowInSeconds())
        })
      }
    }
  })
})
