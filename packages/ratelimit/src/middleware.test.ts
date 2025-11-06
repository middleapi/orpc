import type { RatelimiterMiddlewareContext } from './middleware'
import type { Ratelimiter, RatelimiterLimitResult } from './types'
import { call, os, type } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { RATELIMIT_HANDLER_CONTEXT_SYMBOL } from './handler-plugin'
import { createRatelimitMiddleware, RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL } from './middleware'

describe('createRatelimitMiddleware', () => {
  const createLimiter = (result: RatelimiterLimitResult): Ratelimiter => ({
    limit: vi.fn().mockResolvedValue(result),
  })
  const success: RatelimiterLimitResult = { success: true, limit: 10, remaining: 5, reset: Date.now() + 60000 }

  describe('basic', () => {
    it('applies rate limit successfully', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'key' })
      await expect(call(os.use(mw).handler(() => 'ok'), undefined, { context: {} })).resolves.toBe('ok')
      expect(limiter.limit).toHaveBeenCalledWith('key')
    })

    it('throws TOO_MANY_REQUESTS when limit exceeded', async () => {
      const reset = Date.now() + 60000
      const limiter = createLimiter({ success: false, limit: 10, remaining: 0, reset })
      await expect(call(os.use(createRatelimitMiddleware({ limiter, key: 'k' })).handler(() => 'ok'), undefined, { context: {} }))
        .rejects
        .toMatchObject({ code: 'TOO_MANY_REQUESTS', data: { limit: 10, remaining: 0, reset } })
    })

    it('passes result to handler plugin context', async () => {
      const limiter = createLimiter(success)
      const ctx = {}
      await call(os.use(createRatelimitMiddleware({ limiter, key: 'k' })).handler(() => 'ok'), undefined, {
        context: { [RATELIMIT_HANDLER_CONTEXT_SYMBOL]: ctx },
      })
      expect(ctx).toHaveProperty('ratelimitResult', success)
    })

    it('handles missing plugin context', async () => {
      await expect(call(os.use(createRatelimitMiddleware({ limiter: createLimiter(success), key: 'k' })).handler(() => 'ok'), undefined, { context: {} }))
        .resolves
        .toBe('ok')
    })

    it('handles partial result', async () => {
      await expect(call(os.use(createRatelimitMiddleware({ limiter: createLimiter({ success: true }), key: 'k' })).handler(() => 'ok'), undefined, { context: {} }))
        .resolves
        .toBe('ok')
    })
  })

  describe('dynamic', () => {
    it('supports function limiter', async () => {
      const l1 = createLimiter(success)
      const l2 = createLimiter(success)
      const fn = vi.fn((_, input) => input === 'u1' ? l1 : l2)

      const proc = os
        .use(createRatelimitMiddleware({ limiter: fn, key: 'k' }))
        .handler(({ input }) => input)

      await call(proc, 'u1', { context: {} })
      expect(l1.limit).toHaveBeenCalledWith('k')
      expect(l2.limit).not.toHaveBeenCalled()

      await call(proc, 'u2', { context: {} })
      expect(l2.limit).toHaveBeenCalledWith('k')
    })

    it('supports async functions', async () => {
      const limiter = createLimiter(success)
      const lFn = vi.fn(async () => limiter)
      const kFn = vi.fn(async (_, i: string) => `user:${i}`)

      const procedure = os
        .input(type<string>())
        .use(createRatelimitMiddleware({ limiter: lFn, key: kFn }))
        .handler(({ input }) => input)

      await call(procedure, 'a', { context: {} })
      expect(lFn).toHaveBeenCalledTimes(1)
      expect(kFn).toHaveBeenCalledTimes(1)
      expect(limiter.limit).toHaveBeenCalledWith('user:a')
    })

    it('passes middleware options', async () => {
      const limiter = createLimiter(success)
      const lFn = vi.fn(() => limiter)
      const kFn = vi.fn(() => 'k')
      const procedure = os.use(createRatelimitMiddleware({ limiter: lFn, key: kFn })).handler(({ input }) => input)
      await call(procedure, 'in', { context: {} })
      expect(lFn).toHaveBeenCalledWith(expect.objectContaining({ context: {}, next: expect.any(Function) }), 'in')
      expect(kFn).toHaveBeenCalledWith(expect.objectContaining({ context: {}, next: expect.any(Function) }), 'in')
    })

    it('resolves in parallel', async () => {
      const limiter = createLimiter(success)
      let lt = 0
      let kt = 0
      const lFn = async () => {
        await new Promise(r => setTimeout(r, 10))
        lt = Date.now()
        return limiter
      }
      const kFn = async () => {
        await new Promise(r => setTimeout(r, 10))
        kt = Date.now()
        return 'k'
      }
      await call(os.use(createRatelimitMiddleware({ limiter: lFn, key: kFn })).handler(() => 'ok'), undefined, { context: {} })
      expect(Math.abs(lt - kt)).toBeLessThan(5)
    })
  })

  describe('context', () => {
    it('defines ratelimit context if does not exist', async () => {
      const limiter = createLimiter(success)
      let ctx: any
      const proc = os
        .use(createRatelimitMiddleware({ limiter, key: 'k' }))
        .handler(({ context }) => {
          ctx = context
          return 'ok'
        })
      await call(proc, undefined, { context: {} })
      expect(ctx[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL].limits).toEqual([{ limiter, key: 'k' }])
    })

    it('extends ratelimit context if exists', async () => {
      let ctx: any
      await call(
        os
          .use(createRatelimitMiddleware({
            limiter: createLimiter(success),
            key: 'k',
          }))
          .handler(({ context }) => {
            ctx = context
            return 'ok'
          }),
        undefined,
        {
          context: {
            [RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL]: {
              limits: [{ limiter: createLimiter(success), key: 'k' }],
            },
            userId: '1',
            db: 'pg',
          },
        },
      )
      expect(ctx[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL].limits.length).toBe(2)
    })

    it('isolate ratelimit contexts', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'k', dedupe: false })
      const innerHandlerFn = vi.fn().mockReturnValue('in')
      const inner = os
        .use(mw)
        .handler(innerHandlerFn)
      const outer = os
        .use(mw)
        .handler(async ({ context }) => {
          return `out:${await call(inner, undefined, { context })}:${await call(inner, undefined, { context })}`
        })

      await call(outer, undefined, { context: {} })
      expect(limiter.limit).toHaveBeenCalledTimes(3)
      expect(innerHandlerFn).toHaveBeenCalledTimes(2)
      expect(
        innerHandlerFn.mock.calls[0]![0].context[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL],
      ).not.toBe(
        innerHandlerFn.mock.calls[1]![0].context[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL],
      )
    })
  })

  describe('dedupe', () => {
    it('deduplicates by default', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'k' })
      await call(os.use(mw).use(mw).handler(() => 'ok'), undefined, { context: {} })
      expect(limiter.limit).toHaveBeenCalledTimes(1)
    })

    it('skips dedupe when disabled', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'k', dedupe: false })
      await call(
        os.use(mw).use(mw).handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(limiter.limit).toHaveBeenCalledTimes(2)
    })

    it('dedupes only same limiter+key', async () => {
      const l1 = createLimiter(success)
      const l2 = createLimiter(success)
      await call(
        os.use(createRatelimitMiddleware({ limiter: l1, key: 'k' }))
          .use(createRatelimitMiddleware({ limiter: l2, key: 'k' }))
          .handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(l1.limit).toHaveBeenCalledTimes(1)
      expect(l2.limit).toHaveBeenCalledTimes(1)

      const l3 = createLimiter(success)
      await call(
        os.use(createRatelimitMiddleware({ limiter: l3, key: 'k1' }))
          .use(createRatelimitMiddleware({ limiter: l3, key: 'k2' })).handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(l3.limit).toHaveBeenCalledTimes(2)
    })

    it('accumulates limits', async () => {
      const l1 = createLimiter(success)
      const l2 = createLimiter(success)
      let ctx: any
      await call(
        os.use(createRatelimitMiddleware({ limiter: l1, key: 'k1' }))
          .use(createRatelimitMiddleware({ limiter: l2, key: 'k2' }))
          .handler(({ context }) => {
            ctx = context
            return 'ok'
          }),
        undefined,
        { context: {} },
      )
      expect(ctx[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL].limits)
        .toEqual([{ limiter: l1, key: 'k1' }, { limiter: l2, key: 'k2' }])
    })

    it('dedupes in nested calls', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'k' })
      const inner = os
        .use(mw)
        .handler(() => 'in')
      const outer = os
        .use(mw)
        .handler(async ({ context }) => `out:${await call(inner, undefined, { context })}`)

      await call(outer, undefined, { context: {} })
      expect(limiter.limit).toHaveBeenCalledTimes(1)
    })

    it('handles partial context', async () => {
      const limiter = createLimiter(success)
      await call(
        os.use(createRatelimitMiddleware({ limiter, key: 'k' }))
          .handler(() => 'ok'),
        undefined,
        {
          context: { [RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL]: { limits: [] } as RatelimiterMiddlewareContext },
        },
      )
      expect(limiter.limit).toHaveBeenCalledTimes(1)
    })

    it('dedupes with existing limit', async () => {
      const limiter = createLimiter(success)
      const mw = createRatelimitMiddleware({ limiter, key: 'k' })
      let ctx: any
      const inner = os
        .use(mw)
        .handler(({ context }) => {
          ctx = context
          return 'in'
        })
      const outer = os
        .use(mw)
        .handler(async ({ context }) => await call(inner, undefined, { context }))
      await call(outer, undefined, { context: {} })
      expect(limiter.limit).toHaveBeenCalledTimes(1)
      expect(ctx[RATELIMIT_MIDDLEWARE_CONTEXT_SYMBOL].limits).toHaveLength(1)
    })

    it('respects per-instance dedupe', async () => {
      const limiter = createLimiter(success)
      await call(
        os.use(createRatelimitMiddleware({ limiter, key: 'k', dedupe: true }))
          .use(createRatelimitMiddleware({ limiter, key: 'k', dedupe: false })).handler(() => 'ok'),
        undefined,
        { context: {} },
      )
      expect(limiter.limit).toHaveBeenCalledTimes(2)
    })
  })
})
