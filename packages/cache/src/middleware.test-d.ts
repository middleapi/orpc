import type { CacheContext, CacheStore } from './types'
import { os, type } from '@orpc/server'
import { cache, revalidate } from './middleware'

describe('cache', () => {
  it('can infer context & input types', () => {
    os
      .$context<{ userId: string, cache: CacheStore }>()
      .input(type<{ id: number }>())
      .use(({ next }) => {
        return next({
          context: {
            db: 'postgres',
          },
        })
      })
      .use(
        cache({
          key: async ({ context }, input) => {
            expectTypeOf(input.id).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()
            expectTypeOf(context.cache).toEqualTypeOf<CacheStore>()

            return `planet:${input.id}`
          },
          tags: ({ context }, input) => {
            expectTypeOf(input.id).toBeNumber()
            expectTypeOf(context.userId).toBeString()
            expectTypeOf(context.db).toBeString()

            return [`planet:${input.id}`]
          },
          ttl: ({ context }, input) => {
            expectTypeOf(input.id).toBeNumber()
            expectTypeOf(context.userId).toBeString()

            return 1000
          },
          swr: ({ context }, input) => {
            expectTypeOf(input.id).toBeNumber()
            expectTypeOf(context.userId).toBeString()

            return 500
          },
          enabled: ({ context }, input) => {
            expectTypeOf(input.id).toBeNumber()
            expectTypeOf(context.userId).toBeString()

            return true
          },
        }),
      )
      .handler(({ context, input }) => {
        expectTypeOf(context.cache).toEqualTypeOf<CacheStore>()
        expectTypeOf(context.userId).toBeString()
        expectTypeOf(context.db).toBeString()
        expectTypeOf(input.id).toBeNumber()

        return 'ok'
      })
  })

  it('key is optional and accepts non-string material', () => {
    const base = os.$context<CacheContext>().input(type<{ id: number }>())

    void base.use(cache())
    void base.use(cache({}))
    void base.use(cache({ key: 'k' }))
    void base.use(cache({ key: (_, input) => ({ id: input.id }) }))
  })

  it('requires the cache store to be declared in the initial context', () => {
    void os.$context<CacheContext>().use(cache({ key: 'k' }))

    // @ts-expect-error - initial context must provide the cache store
    void os.use(cache({ key: 'k' }))
  })
})

describe('revalidate', () => {
  it('can infer context & input types', () => {
    os
      .$context<{ userId: string, cache: CacheStore }>()
      .input(type<{ id: number }>())
      .use(
        revalidate(async ({ context }, input) => {
          expectTypeOf(input.id).toBeNumber()
          expectTypeOf(context.userId).toBeString()
          expectTypeOf(context.cache).toEqualTypeOf<CacheStore>()

          return `planet:${input.id}`
        }),
      )
      .handler(({ context, input }) => {
        expectTypeOf(context.cache).toEqualTypeOf<CacheStore>()
        expectTypeOf(context.userId).toBeString()
        expectTypeOf(input.id).toBeNumber()

        return 'ok'
      })
  })

  it('accepts a single tag, a non-empty tag list, but rejects an empty one', () => {
    const base = os.$context<CacheContext>()

    void base.use(revalidate('planets'))
    void base.use(revalidate(['planets', 'planet:1']))
    void base.use(revalidate(() => ['planets']))

    // @ts-expect-error - tags must not be empty
    void base.use(revalidate([]))
  })

  it('requires the cache store to be declared in the initial context', () => {
    void os.$context<CacheContext>().use(revalidate('t'))

    // @ts-expect-error - initial context must provide the cache store
    void os.use(revalidate('t'))
  })
})
