import type { Client } from '@orpc/client'
import type { AnySchema, ErrorFromErrorMap, ErrorMap, MergedErrorMap, MergedMeta } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Context } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Middleware, MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { ActionableClient, ActionableError } from './procedure-action'
import type { DecoratedProcedure } from './procedure-decorated'

const builder = {} as DecoratedProcedure<
  InitialContext,
  CurrentContext,
  typeof inputSchema,
  typeof outputSchema,
  typeof baseErrorMap,
  BaseMeta
>

describe('DecoratedProcedure', () => {
  it('is a procedure', () => {
    expectTypeOf(builder).toMatchTypeOf<
      Procedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()
  })

  it('.errors', () => {
    const applied = builder.errors({
      BAD_GATEWAY: { message: 'BAD_GATEWAY' },
      OVERRIDE: { message: 'OVERRIDE' },
    })

    expectTypeOf(applied).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { BAD_GATEWAY: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.errors({ BAD_GATEWAY: { data: {} } })
    // @ts-expect-error - not allow redefine error map
    builder.errors({ BASE: baseErrorMap.BASE })
  })

  it('.meta', () => {
    const applied = builder.meta({ mode: 'dev', log: true })

    expectTypeOf(applied).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        MergedMeta<BaseMeta, { readonly mode: 'dev', readonly log: true }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.meta({ log: 'INVALID' })
  })

  it('.route', () => {
    const applied = builder.route({ method: 'POST', path: '/v2/users', tags: ['tag'] })

    expectTypeOf(applied).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.route({ method: 'INVALID' })
  })

  describe('.use', () => {
    it('without map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()
        expectTypeOf(procedure).toEqualTypeOf<Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>>()
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<{ output: number }>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()

        return next({
          context: {
            extra: true,
          },
        })
      })

      expectTypeOf(applied).toEqualTypeOf<
        DecoratedProcedure<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- invalid TInContext
      builder.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>)
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}))
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}))
      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }))
    })

    it('with map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors }, input: { mapped: string }, output) => {
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()
        expectTypeOf(procedure).toEqualTypeOf<Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>>()
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<{ output: number }>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()

        return next({
          context: {
            extra: true,
          },
        })
      }, (input) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()
        return { mapped: input.input }
      })

      expectTypeOf(applied).toEqualTypeOf<
        DecoratedProcedure<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- invalid TInContext
      builder.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>, () => {})
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}), () => {})
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}), () => {})
      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }), () => { })
    })

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, any, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        DecoratedProcedure<
          InitialContext & { cacheable?: boolean },
          Omit<CurrentContext, never> & Record<never, never>,
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      expectTypeOf(builder.use(mid, () => { })).toEqualTypeOf<
        DecoratedProcedure<
          InitialContext & { cacheable?: boolean },
          Omit<CurrentContext, never> & Record<never, never>,
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()
    })
  })

  it('.callable', () => {
    const applied = builder.callable({
      context: async (clientContext: { batch?: boolean }) => ({ db: 'postgres' }),
    })

    expectTypeOf(applied).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
      & Client<{ batch?: boolean }, { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
    >()
  })

  it('.actionable', () => {
    const applied = builder.actionable({
      context: async (clientContext: { batch?: boolean }) => ({ db: 'postgres' }),
    })

    expectTypeOf(applied).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
      & ActionableClient<{ input: number }, { output: string }, ActionableError<ErrorFromErrorMap<typeof baseErrorMap>>>
    >()

    builder.actionable({
      // @ts-expect-error --- all clientContext must be optional
      context: async (clientContext: { batch: boolean }) => ({ db: 'postgres' }),
    })
  })
})
