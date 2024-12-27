import type { Middleware, MiddlewareMeta } from './middleware'

describe('middleware', () => {
  it('just a function', () => {
    const mid: Middleware<{ auth: boolean }, undefined, unknown, unknown> = (input, context, meta) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ auth: boolean }>()
      expectTypeOf(meta).toEqualTypeOf<MiddlewareMeta<unknown>>()

      return meta.next({})
    }

    const mid2: Middleware<{ auth: boolean }, undefined, unknown, unknown> = async (input, context, meta) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ auth: boolean }>()
      expectTypeOf(meta).toEqualTypeOf<MiddlewareMeta<unknown>>()

      return await meta.next({})
    }

    // @ts-expect-error - missing return type
    const mid3: Middleware<{ auth: boolean }, undefined, unknown, unknown> = (input, context, meta) => {
    }

    // @ts-expect-error - missing return type
    const mid4: Middleware<{ auth: boolean }, undefined, unknown, unknown> = async (input, context, meta) => {
    }
  })

  it('require return valid extra context', () => {
    const mid0: Middleware<undefined, undefined, unknown, unknown> = (_, __, meta) => {
      return meta.next({ })
    }

    const mid: Middleware<undefined, { userId: string }, unknown, unknown > = (_, __, meta) => {
      return meta.next({ context: { userId: '1' } })
    }

    // @ts-expect-error invalid extra context
    const mid2: Middleware<undefined, { userId: string }, unknown, unknown> = (_, __, meta) => {
      return meta.next({ context: { userId: 1 } })
    }

    const mid3: Middleware<undefined, { userId: string }, unknown, unknown> = (_, __, meta) => {
      // @ts-expect-error missing extra context
      return meta.next({})
    }
  })

  it('can type input', () => {
    const mid: Middleware<undefined, undefined, { id: string }, unknown> = (input, context, meta) => {
      expectTypeOf(input).toEqualTypeOf<{ id: string }>()

      return meta.next({})
    }
  })

  it('can type output', () => {
    const mid: Middleware<undefined, undefined, unknown, { id: string }> = async (_, context, meta) => {
      const result = await meta.next({})

      expectTypeOf(result.output).toEqualTypeOf<{ id: string }>()

      return meta.output({ id: '1' })
    }

    // @ts-expect-error invalid output
    const mid2: Middleware<undefined, undefined, unknown, { id: string }> = async (_, context, meta) => {
      return meta.output({ id: 123 })
    }
  })

  it('can infer types from function', () => {
    const handler = (input: 'input', context: { context: 'context' }, meta: MiddlewareMeta<'output'>) => {
      return meta.next({ context: { extra: 'extra' as const } })
    }

    type Inferred = typeof handler extends Middleware<infer TContext, infer TExtraContext, infer TInput, infer TOutput>
      ? [TContext, TExtraContext, TInput, TOutput]
      : never

    expectTypeOf<Inferred>().toEqualTypeOf<
      [{ context: 'context' }, { extra: 'extra' }, 'input', 'output']
    >()
  })
})
