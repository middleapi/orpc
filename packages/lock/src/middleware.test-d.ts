import { ORPCError, os, type } from '@orpc/server'

import type { LockTimeoutError } from './error'
import { lock } from './middleware'
import type { Locker } from './types'

describe('lock', () => {
  it('can infer context & input & meta types', () => {
    const procedure = os
      .$context<{ userId: string; locker: Locker }>()
      .input(type<{ id: string }>())
      .use(({ next }) => {
        return next({
          context: {
            db: 'postgres',
          },
        })
      })
      .use(
        lock({
          locker: async ({ context }, input) => {
            expectTypeOf(input.id).toBeString()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return context.locker
          },
          key: ({ context }, input) => {
            expectTypeOf(input.id).toBeString()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return `report:${input.id}`
          },
          ttl: ({ context }, input) => {
            expectTypeOf(input.id).toBeString()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return 1000
          },
          timeout: ({ context }, input) => {
            expectTypeOf(input.id).toBeString()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return undefined
          },
          error: (error, { context }, input) => {
            expectTypeOf(error).toEqualTypeOf<LockTimeoutError>()
            expectTypeOf(input.id).toBeString()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return new ORPCError('LOCKED')
          },
        }),
      )
      .handler(({ context, input }) => {
        expectTypeOf(context.locker).toEqualTypeOf<Locker>()
        expectTypeOf(context['lock/waited']).toEqualTypeOf<boolean>()
        expectTypeOf(context.userId).toBeString()
        expectTypeOf(context.db).toBeString()
        expectTypeOf(input.id).toBeString()

        return 'ok'
      })
  })
})
