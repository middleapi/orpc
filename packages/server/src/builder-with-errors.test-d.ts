import type { ContractProcedure, ErrorMap, MergedErrorMap, ORPCErrorConstructorMap, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta } from '../../contract/tests/shared'
import type { BuilderWithErrors } from './builder-with-errors'
import type { BuilderWithMiddlewares } from './builder-with-middlewares'
import type { Context } from './context'
import type { Lazy } from './lazy'
import type { MiddlewareOutputFn } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { Procedure } from './procedure'
import type { ProcedureBuilder } from './procedure-builder'
import type { ProcedureBuilderWithInput } from './procedure-builder-with-input'
import type { ProcedureBuilderWithOutput } from './procedure-builder-with-output'
import type { DecoratedProcedure } from './procedure-decorated'
import type { AdaptedRouter } from './router'
import type { RouterBuilder } from './router-builder'
import { inputSchema, outputSchema } from '../../contract/tests/shared'
import { type InitialContext, router } from '../tests/shared'

const builder = {} as BuilderWithErrors<InitialContext, typeof baseErrorMap, BaseMeta>

describe('BuilderWithErrors', () => {
  it('is a contract procedure', () => {
    expectTypeOf(builder).toMatchTypeOf<
      ContractProcedure<
        undefined,
        undefined,
        Record<never, never>,
        BaseMeta
      >
    >()
  })

  describe('.middleware', () => {
    it('works', () => {
      expectTypeOf(
        builder.middleware(({ context, next, path, procedure, errors, signal }, input, output) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<InitialContext>()
          expectTypeOf(path).toEqualTypeOf<string[]>()
          expectTypeOf(procedure).toEqualTypeOf<
            Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>
          >()
          expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<any>>()
          expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
          expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

          return next({
            context: {
              extra: true,
            },
          })
        }),
      ).toEqualTypeOf<
        DecoratedMiddleware<InitialContext, { extra: boolean }, unknown, any, ORPCErrorConstructorMap<typeof baseErrorMap>, BaseMeta>
      >()

      // @ts-expect-error --- conflict context
      builder.middleware(({ next }) => next({ db: 123 }))
    })

    it('can type input and output', () => {
      expectTypeOf(
        builder.middleware(({ next }, input: 'input', output: MiddlewareOutputFn<'output'>) => next()),
      ).toEqualTypeOf<
        DecoratedMiddleware<InitialContext, Record<never, never>, 'input', 'output', ORPCErrorConstructorMap<typeof baseErrorMap>, BaseMeta>
      >()
    })
  })

  it('.errors', () => {
    expectTypeOf(
      builder.errors({
        BAD_GATEWAY: { message: 'BAD' },
        OVERRIDE: { message: 'OVERRIDE' },
      }),
    ).toEqualTypeOf<
      BuilderWithErrors<
        InitialContext,
        MergedErrorMap<typeof baseErrorMap, { BAD_GATEWAY: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.errors({ BAD_GATEWAY: { data: {} } })
  })

  it('.use', () => {
    const applied = builder.use(({ context, next, path, procedure, errors, signal }, input, output) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ db: string }>()
      expectTypeOf(path).toEqualTypeOf<string[]>()
      expectTypeOf(procedure).toEqualTypeOf<
        Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>
      >()
      expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<unknown>>()
      expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

      return next({
        context: {
          extra: true,
        },
      })
    })

    expectTypeOf(applied).toEqualTypeOf<
      BuilderWithMiddlewares<InitialContext, InitialContext & { extra: boolean }, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error --- conflict context
    builder.use(({ next }) => next({ context: { db: 123 } }))
    // conflict but not detected
    expectTypeOf(builder.use(({ next }) => next({ context: { db: undefined } }))).toMatchTypeOf<never>()
    // @ts-expect-error --- input is not match
    builder.use(({ next }, input: 'invalid') => next({}))
    // @ts-expect-error --- output is not match
    builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}))
  })

  it('.meta', () => {
    expectTypeOf(builder.meta({ log: true })).toEqualTypeOf<
      ProcedureBuilder<InitialContext, InitialContext, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ log: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ path: '/test', method: 'GET' })).toEqualTypeOf<
      ProcedureBuilder<InitialContext, InitialContext, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid method
    builder.route({ method: 'INVALID' })
  })

  it('.input', () => {
    expectTypeOf(builder.input(inputSchema)).toEqualTypeOf<
      ProcedureBuilderWithInput<InitialContext, InitialContext, typeof inputSchema, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid schema
    builder.input({})
  })

  it('.output', () => {
    expectTypeOf(builder.output(outputSchema)).toEqualTypeOf<
      ProcedureBuilderWithOutput<InitialContext, InitialContext, typeof outputSchema, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid schema
    builder.output({})
  })

  it('.handler', () => {
    const procedure = builder.handler(({ input, context, procedure, path, signal, errors }) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ db: string }>()
      expectTypeOf(path).toEqualTypeOf<string[]>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()
      expectTypeOf(procedure).toEqualTypeOf<
        Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>
      >()
      expectTypeOf(errors).toEqualTypeOf < ORPCErrorConstructorMap<typeof baseErrorMap>>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

      return 456
    })

    expectTypeOf(procedure).toMatchTypeOf<
      DecoratedProcedure<{ db: string }, { db: string }, undefined, undefined, number, typeof baseErrorMap, BaseMeta>
    >()
  })

  it('.prefix', () => {
    expectTypeOf(builder.prefix('/test')).toEqualTypeOf<
      RouterBuilder<InitialContext, InitialContext, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid prefix
    builder.prefix(123)
  })

  it('.tag', () => {
    expectTypeOf(builder.tag('test', 'test2')).toEqualTypeOf<
      RouterBuilder<InitialContext, InitialContext, typeof baseErrorMap, BaseMeta>
    >()
  })

  it('.router', () => {
    expectTypeOf(builder.router(router)).toEqualTypeOf<
      AdaptedRouter<typeof router, InitialContext, typeof baseErrorMap>
    >()

    builder.router({
      // @ts-expect-error - initial context is not match
      ping: {} as Procedure<{ invalid: true }, Context, undefined, undefined, unknown, Record<never, never>, BaseMeta>,
    })

    builder.router({
      // @ts-expect-error - meta def is not match
      ping: {} as Procedure<Context, Context, undefined, undefined, unknown, Record<never, never>, { invalid: true }>,
    })
  })

  it('.lazy', () => {
    expectTypeOf(builder.lazy(() => Promise.resolve({ default: router }))).toEqualTypeOf<
      AdaptedRouter<Lazy<typeof router>, InitialContext, typeof baseErrorMap>
    >()

    // @ts-expect-error - initial context is not match
    builder.lazy(() => Promise.resolve({
      default: {
        ping: {} as Procedure<{ invalid: true }, Context, undefined, undefined, unknown, Record<never, never>, BaseMeta>,
      },
    }))

    // @ts-expect-error - meta def is not match
    builder.lazy(() => Promise.resolve({
      ping: {} as Procedure<Context, Context, undefined, undefined, unknown, Record<never, never>, { invalid: true }>,
    }))
  })
})
