import type { Client, ClientRest, ErrorFromErrorMap, ErrorMap, MergedErrorMap, ORPCErrorConstructorMap, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Context } from './context'
import type { MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'

const builder = {} as DecoratedProcedure<
  InitialContext,
  CurrentContext,
  typeof inputSchema,
  typeof outputSchema,
  { output: number },
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
        { output: number },
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
        { output: number },
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
        { output: number },
        typeof baseErrorMap,
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
        { output: number },
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
        expectTypeOf(path).toEqualTypeOf<string[]>()
        expectTypeOf(procedure).toEqualTypeOf<Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>>()
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
          InitialContext,
          CurrentContext & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          { output: number },
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: 123 } }))
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}))
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}))
      // conflict context but not detected
      expectTypeOf(builder.use(({ next }) => next({ context: { db: undefined } }))).toEqualTypeOf<never>()
    })

    it('with map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors }, input: { mapped: string }, output) => {
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<string[]>()
        expectTypeOf(procedure).toEqualTypeOf<Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>>()
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
          InitialContext,
          CurrentContext & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          { output: number },
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- conflict context
      builder.use(({ next }) => ({ context: { db: 123 } }), () => {})
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}), () => {})
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}), () => {})
      // conflict context but not detected
      expectTypeOf(builder.use(({ next }) => next({ context: { db: undefined } }), () => {})).toEqualTypeOf<never>()
    })
  })

  it('.callable', () => {
    const applied = builder.callable({
      context: async (clientContext: 'client-context') => ({ db: 'postgres' }),
    })

    expectTypeOf(applied).toEqualTypeOf<
      Procedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        { output: number },
        typeof baseErrorMap,
        BaseMeta
      >
      & Client<'client-context', { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
    >()
  })

  it('.actionable', () => {
    const applied = builder.actionable({
      context: async (clientContext: 'client-context') => ({ db: 'postgres' }),
    })

    expectTypeOf(applied).toEqualTypeOf<
      Procedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        { output: number },
        typeof baseErrorMap,
        BaseMeta
      >
      & ((...rest: ClientRest<'client-context', { input: number }>) => Promise<{ output: string }>)
    >()
  })
})
