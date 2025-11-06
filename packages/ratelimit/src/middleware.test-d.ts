import type { Ratelimiter } from './types'
import { os, type } from '@orpc/server'
import { createRatelimitMiddleware } from './middleware'

describe('createRatelimitMiddleware', () => {
  it('can infer context & input & meta types', () => {
    const procedure = os
      .$context<{ userId: string, ratelimiter: Ratelimiter }>()
      .$meta<{ meta?: string }>({})
      .input(type<{ amount: number }>())
      .use(({ next }) => {
        return next({
          context: {
            db: 'postgres',
          },
        })
      })
      .use(
        createRatelimitMiddleware({
          limiter: async ({ context, procedure }, input) => {
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()
            expectTypeOf(procedure['~orpc'].meta.meta).toEqualTypeOf<string | undefined>()
            return context.ratelimiter
          },
          key: ({ context, procedure }, input) => {
            expectTypeOf(input.amount).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()
            expectTypeOf(procedure['~orpc'].meta.meta).toEqualTypeOf<string | undefined>()
            return context.userId
          },
        }),
      )
      .handler(({ context, input, procedure }) => {
        expectTypeOf(context.ratelimiter).toEqualTypeOf<Ratelimiter>()
        expectTypeOf(context.userId).toBeString()
        expectTypeOf(context.db).toBeString()
        expectTypeOf(input.amount).toBeNumber()
        expectTypeOf(procedure['~orpc'].meta.meta).toEqualTypeOf<string | undefined>()
        return 'ok'
      })
  })
})
