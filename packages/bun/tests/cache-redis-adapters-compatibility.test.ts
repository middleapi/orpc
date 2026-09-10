import type { CacheStore } from '@orpc/experimental-cache'
import { RedisCacheStore } from '@orpc/experimental-cache/redis'
import { nowInSeconds, sleep } from '@orpc/shared'
import { RedisClient } from 'bun'
import { afterAll, describe, expect, it } from 'bun:test'
import { createClient } from 'redis'
import { experimental_BunRedisCacheStore } from '../src/redis-cache'

const REDIS_URL = Bun.env.REDIS_URL

/**
 * These tests require a real Redis server. Set `REDIS_URL` before running them.
 *
 * When adding new tests, always use unique keys to avoid conflicts with other cases.
 *
 * All adapters must connect to the same server.
 */
const stores: Array<{ name: string, store: CacheStore }> = []
const prefix = `redis-adapters:${crypto.randomUUID()}:`

if (REDIS_URL) {
  const redis = createClient({ url: REDIS_URL })
  const bunRedis = new RedisClient(REDIS_URL)

  afterAll(() => {
    redis.close()
    bunRedis.close()
  })

  stores.push({ name: 'redis', store: new RedisCacheStore(redis, { prefix }) })
  stores.push({ name: 'bun redis', store: new experimental_BunRedisCacheStore(bunRedis, { prefix }) })
}

describe('cache redis adapters compatibility', () => {
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

          await source.store.getOrSet([['planet', 'find'], { b: 2, id }], async () => output, { tags: [tag], ttl: 60 })

          const entry = await target.store.getOrSet([['planet', 'find'], { id, b: 2 }], async () => 'refilled', { tags: [tag], ttl: 60 })
          expect(entry.output).toEqual(output)
          expect(entry.tags).toEqual([tag])
          expect(entry.expiresAt).toBeGreaterThan(nowInSeconds())

          await target.store.revalidate({ tags: [tag] })

          await expect(source.store.getOrSet([['planet', 'find'], { b: 2, id }], async () => 'refilled', { tags: [tag] })).resolves.toMatchObject({ output: 'refilled' })
        }, { timeout: 20_000 })

        it(`shares tag counters: ${source.name} → ${target.name}`, async () => {
          const key = `counter:${crypto.randomUUID()}`
          const tag = `tag:${crypto.randomUUID()}`

          await source.store.getOrSet(key, async () => 'v1', { tags: [tag] })
          await target.store.revalidate({ tags: [tag] })

          await expect(target.store.getOrSet(key, async () => 'v2', { tags: [tag] })).resolves.toMatchObject({ output: 'v2' })
          await expect(source.store.getOrSet(key, async () => 'v3', { tags: [tag] })).resolves.toMatchObject({ output: 'v2' })

          await source.store.revalidate({ tags: [tag] })
          await expect(target.store.getOrSet(key, async () => 'v4', { tags: [tag] })).resolves.toMatchObject({ output: 'v4' })
        }, { timeout: 20_000 })

        it(`shares retention: ${source.name} → ${target.name}`, async () => {
          const noSwr = `no-swr:${crypto.randomUUID()}`
          const swr = `swr:${crypto.randomUUID()}`

          await source.store.getOrSet(noSwr, async () => 'v', { ttl: 1 })
          await source.store.getOrSet(swr, async () => 'v', { ttl: 1, swr: 10 })

          await sleep(1500)

          await expect(target.store.getOrSet(noSwr, async () => 'refilled', { ttl: 1 })).resolves.toMatchObject({ output: 'refilled' })

          const waitUntil = (_promise: Promise<unknown>) => {}
          const stale = await target.store.getOrSet(swr, async () => 'refilled', { ttl: 1, swr: 10, waitUntil })
          expect(stale.output).toBe('v')
          expect(stale.expiresAt).toBeLessThanOrEqual(nowInSeconds())
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

          const holder = source.store.getOrSet(key, async () => {
            acquired()
            await held
            return 'held'
          })
          await holding

          let settled = false
          const waiter = target.store.getOrSet(key, async () => 'refilled').then((entry) => {
            settled = true
            return entry
          })

          await sleep(300)
          expect(settled).toBe(false)

          release()
          await holder
          await expect(waiter).resolves.toMatchObject({ output: 'held' })
        }, { timeout: 20_000 })
      }
    }
  })
})
