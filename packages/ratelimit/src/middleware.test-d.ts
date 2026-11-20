import { ORPCError, os, type } from '@orpc/server'

import { ratelimit } from './middleware'
import type { RateLimiter, RateLimitResult } from './types'

describe('ratelimit', () => {
  it('can infer context & input & meta types', () => {
    const procedure = os
      .$context<{ userId: string; rateLimiter: RateLimiter }>()
      .input(type<{ amount: number }>())
      .use(({ next }) => {
        return next({
          context: {
            db: 'postgres',
          },
        })
      })
      .use(
        ratelimit({
          limiter: async ({ context }, input) => {
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return context.rateLimiter
          },
          key: ({ context }, input) => {
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return context.userId
          },
          weight: ({ context }, input) => {
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return 1
          },
          error: (result, { context }, input) => {
            expectTypeOf(result).toEqualTypeOf<RateLimitResult>()
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return new ORPCError('RATE_LIMITED')
          },
        }),
      )
      .handler(({ context, input }) => {
        expectTypeOf(context.rateLimiter).toEqualTypeOf<RateLimiter>()
        expectTypeOf(context.userId).toBeString()
        expectTypeOf(context.db).toBeString()
        expectTypeOf(input.amount).toBeNumber()

        return 'ok'
      })
  })
})
