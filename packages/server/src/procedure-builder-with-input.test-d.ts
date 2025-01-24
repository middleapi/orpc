import type { ContractProcedure, ErrorMap, MergedErrorMap, ORPCErrorConstructorMap, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Context } from './context'
import type { MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { ProcedureBuilderWithInput } from './procedure-builder-with-input'
import type { ProcedureBuilderWithoutHandler } from './procedure-builder-without-handler'
import type { DecoratedProcedure } from './procedure-decorated'
import { outputSchema } from '../../contract/tests/shared'

const builder = {} as ProcedureBuilderWithInput<
  InitialContext,
  CurrentContext,
  typeof inputSchema,
  typeof baseErrorMap,
  BaseMeta
>

describe('ProcedureBuilderWithInput', () => {
  it('is a contract procedure', () => {
    expectTypeOf(builder).toMatchTypeOf<
      ContractProcedure<
        typeof inputSchema,
        undefined,
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
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        MergedErrorMap<typeof baseErrorMap, { BAD_GATEWAY: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.errors({ BAD_GATEWAY: { data: {} } })
  })

  it('.meta', () => {
    const applied = builder.meta({ mode: 'dev', log: true })

    expectTypeOf(applied).toEqualTypeOf<
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
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
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
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
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<unknown>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()

        return next({
          context: {
            extra: true,
          },
        })
      })

      expectTypeOf(applied).toEqualTypeOf<
        ProcedureBuilderWithInput<
          InitialContext,
          CurrentContext & { extra: boolean },
          typeof inputSchema,
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
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<unknown>>()
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
        ProcedureBuilderWithInput<
          InitialContext,
          CurrentContext & { extra: boolean },
          typeof inputSchema,
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

  it('.output', () => {
    const applied = builder.output(outputSchema)

    expectTypeOf(applied).toEqualTypeOf<
      ProcedureBuilderWithoutHandler<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error --- invalid schema
    builder.input({})
  })

  it('.handler', () => {
    const procedure = builder.handler(({ input, context, procedure, path, signal, errors }) => {
      expectTypeOf(input).toEqualTypeOf<{ input: string }>()
      expectTypeOf(context).toEqualTypeOf<CurrentContext>()
      expectTypeOf(procedure).toEqualTypeOf<Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>>()
      expectTypeOf(path).toEqualTypeOf<string[]>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()
      expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()

      return { output: 456 }
    })

    expectTypeOf(procedure).toEqualTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        undefined,
        { output: number },
        typeof baseErrorMap,
        BaseMeta
      >
    >()
  })
})
