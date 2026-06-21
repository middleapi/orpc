import type { Publisher } from '../src'
import { getEventMeta, withEventMeta } from '@standardserver/core'
import { Redis } from '@upstash/redis'
import { createClient } from 'redis'
import { RedisPublisher } from '../src/adapters/redis'
import { UpstashPublisher } from '../src/adapters/upstash'

const REDIS_URL = process.env.REDIS_URL
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * These tests require a real Redis/Upstash Redis server.
 * Set `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` before running them.
 *
 * When adding new tests, always use unique keys to avoid conflicts with other cases.
 *
 * Point REDIS_URL and Upstash variables to the same server, as some cross-adapter tests rely on this.
 */
describe('redis adapters', { timeout: 20_000 }, () => {
  const publishers: Array<{ name: string, publisher: Publisher<any> }> = []
  const prefix = `redis-adapters:${crypto.randomUUID()}`

  if (REDIS_URL) {
    const redis = createClient({ url: REDIS_URL })
    const publisher = new RedisPublisher(redis, {
      prefix,
      replay: { enabled: true, seconds: 10 },
    })
    publishers.push({ name: 'redis', publisher })
  }

  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })
    const publisher = new UpstashPublisher(redis, {
      prefix,
      replay: { enabled: true, seconds: 10 },
    })
    publishers.push({ name: 'upstash', publisher })
  }

  describe.skipIf(publishers.length < 2)('cross-adapter compatibility', () => {
    for (const source of publishers) {
      for (const target of publishers) {
        if (source === target) {
          continue
        }

        it(`delivers live events from ${source.name} to ${target.name} and replays from the last received id`, async () => {
          const event = `live:${crypto.randomUUID()}`
          const liveListener = vi.fn()

          const unsubscribeLive = await target.publisher.subscribe(event, liveListener)

          await source.publisher.publish(event, withEventMeta({ order: 1 }, { id: 'client-id', comments: ['cross-adapter'] }))
          await source.publisher.publish(event, { order: 2 })

          await vi.waitFor(() => {
            expect(liveListener).toHaveBeenCalledTimes(2)
          })

          const firstDelivered = liveListener.mock.calls[0]![0]
          const secondDelivered = liveListener.mock.calls[1]![0]

          expect(firstDelivered).toEqual({ order: 1 })
          expect(getEventMeta(firstDelivered)?.id).toEqual(expect.any(String))
          expect(getEventMeta(firstDelivered)?.id).not.toBe('client-id')
          expect(getEventMeta(firstDelivered)?.comments).toEqual(['cross-adapter'])

          expect(secondDelivered).toEqual({ order: 2 })
          expect(getEventMeta(secondDelivered)?.id).toEqual(expect.any(String))

          await unsubscribeLive()

          await source.publisher.publish(event, { order: 3 })

          const replayed = vi.fn()
          const unsubscribeReplay = await target.publisher.subscribe(event, replayed, {
            lastEventId: getEventMeta(secondDelivered)?.id,
          })

          await vi.waitFor(() => {
            expect(replayed).toHaveBeenCalledTimes(1)
          })

          const replayedPayload = replayed.mock.calls[0]![0]

          expect(replayedPayload).toEqual({ order: 3 })
          expect(getEventMeta(replayedPayload)?.id).toEqual(expect.any(String))

          await unsubscribeReplay()
        })
      }
    }
  })
})
