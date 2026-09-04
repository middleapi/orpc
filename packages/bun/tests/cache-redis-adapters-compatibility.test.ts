import type { CacheStore } from '@orpc/experimental-cache'
import { RedisCacheStore } from '@orpc/experimental-cache/redis'
import { nowInSeconds } from '@orpc/shared'
import { RedisClient } from 'bun'
import { afterAll, describe, expect, it } from 'bun:test'
import { createClient } from 'redis'
import { BunRedisCacheStore } from '../src/redis-cache'

const REDIS_URL = Bun.env.REDIS_URL

describe.concurrent('cache redis adapters compatibility', async () => {
  const stores: Array<{ name: string, store: CacheStore }> = []
  const prefix = `redis-adapters:${crypto.randomUUID()}:`

  if (REDIS_URL) {
    const redis = createClient({ url: REDIS_URL })

    afterAll(() => {
      redis.close()
    })

    stores.push({
      name: 'redis',
      store: new RedisCacheStore(redis, { prefix }),
    })

    const bunRedis = new RedisClient(REDIS_URL)

    afterAll(() => {
      bunRedis.close()
    })

    stores.push({
      name: 'bun redis',
      store: new BunRedisCacheStore(bunRedis, { prefix }),
    })
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
      }
    }
  })
})
