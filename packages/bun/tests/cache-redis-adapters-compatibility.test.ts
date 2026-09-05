import type { CacheStore } from '@orpc/experimental-cache'
import { RedisCacheStore } from '@orpc/experimental-cache/redis'
import { nowInSeconds, sleep } from '@orpc/shared'
import { RedisClient } from 'bun'
import { afterAll, describe, expect, it } from 'bun:test'
import { createClient } from 'redis'
import { BunRedisCacheStore } from '../src/redis-cache'

const REDIS_URL = Bun.env.REDIS_URL

/**
 * These tests require a real Redis server. Set `REDIS_URL` before running them.
 *
 * When adding new tests, always use unique keys to avoid conflicts with other cases.
 *
 * All adapters must connect to the same server.
 */
describe.concurrent('cache redis adapters compatibility', async () => {
  const stores: Array<{ name: string, store: CacheStore }> = []
  const prefix = `redis-adapters:${crypto.randomUUID()}:`

  if (REDIS_URL) {
    const redis = createClient({ url: REDIS_URL })

    afterAll(() => {
      redis.close()
    })

    stores.push({ name: 'redis', store: new RedisCacheStore(redis, { prefix }) })

    const bunRedis = new RedisClient(REDIS_URL)

    afterAll(() => {
      bunRedis.close()
    })

    stores.push({ name: 'bun redis', store: new BunRedisCacheStore(bunRedis, { prefix }) })
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
        }, { timeout: 20_000 })

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
        }, { timeout: 20_000 })

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
        }, { timeout: 20_000 })

        it(`shares locks: ${source.name} → ${target.name}`, async () => {
          const key = `lock:${crypto.randomUUID()}`
          let release!: () => void
          const held = new Promise<void>((resolve) => {
            release = resolve
          })
          let acquired!: () => void
          const holding = new Promise<void>((resolve) => {
            acquired = resolve
          })

          const holder = source.store.lock!(key, async () => {
            acquired()
            await held
          })
          await holding

          let settled = false
          const waiter = target.store.lock!(key, async waited => waited).then((waited) => {
            settled = true
            return waited
          })

          await sleep(300)
          expect(settled).toBe(false)

          release()
          await holder
          await expect(waiter).resolves.toBe(true)
        }, { timeout: 20_000 })
      }
    }
  })
})
