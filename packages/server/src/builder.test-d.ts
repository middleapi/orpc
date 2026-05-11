import type { AnySchema, ContractProcedure, ErrorMap, MergedErrorMap, MergedMeta, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Builder } from './builder'
import type { BuilderWithMiddlewares, ProcedureBuilder, ProcedureBuilderWithInput, ProcedureBuilderWithOutput, RouterBuilder } from './builder-variants'
import type { Context } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazy } from './lazy'
import type { Middleware, MiddlewareOutputFn } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { Procedure } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'
import type { EnhancedRouter } from './router-utils'
import * as z from 'zod'
import { generalSchema } from '../../contract/tests/shared'
import { router } from '../tests/shared'

const builder = {} as Builder<
  InitialContext,
  CurrentContext,
  typeof inputSchema,
  typeof outputSchema,
  typeof baseErrorMap,
  BaseMeta
>

describe('Builder', () => {
  it('is a contract procedure', () => {
    expectTypeOf(builder).toMatchTypeOf<
      ContractProcedure<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()
  })

  it('.$config', () => {
    const applied = builder.$config({
      initialInputValidationIndex: Number.NEGATIVE_INFINITY,
      initialOutputValidationIndex: Number.POSITIVE_INFINITY,
    })

    expectTypeOf(applied).toEqualTypeOf<
      Builder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    builder.$config({
      // @ts-expect-error - must be number
      initialInputValidationIndex: 'INVALID',
    })
  })

  it('.$context', () => {
    expectTypeOf(builder.$context()).toEqualTypeOf<
      Builder<
        Context & Record<never, never>,
        Context,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()
    expectTypeOf(builder.$context<{ anything: string }>()).toEqualTypeOf<
      Builder<
        { anything: string } & Record<never, never>,
        { anything: string },
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()
  })

  it('.$meta', () => {
    expectTypeOf(builder.$meta<{ auth?: boolean }>({})).toEqualTypeOf<
      Builder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        { auth?: boolean } & Record<never, never>
      >
    >()

    // @ts-expect-error - initial meta is required
    builder.$meta<{ auth?: boolean }>()
    // @ts-expect-error - auth is missing in initial meta
    builder.$meta<{ auth: boolean }>({})
  })

  it('.$route', () => {
    expectTypeOf(builder.$route({ method: 'GET' })).toEqualTypeOf<
      Builder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid method
    builder.$route({ method: 'INVALID' })
  })

  describe('.$input', () => {
    it('with actual schema', () => {
      const schema = z.void()

      expectTypeOf(builder.$input(schema)).toEqualTypeOf<
        Builder<
          InitialContext,
          CurrentContext,
          typeof schema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- invalid schema
      builder.$input({})
    })

    it('with types only', () => {
      expectTypeOf(builder.$input<Schema<void, unknown>>()).toEqualTypeOf<
        Builder<
          InitialContext,
          CurrentContext,
          Schema<void, unknown>,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- invalid schema
      builder.$input<'invalid'>()
    })
  })

  describe('.middleware', () => {
    it('works', () => {
      expectTypeOf(
        builder.middleware(({ context, next, path, procedure, errors, signal }, input, output) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<InitialContext>()
          expectTypeOf(path).toEqualTypeOf<readonly string[]>()
          expectTypeOf(procedure).toEqualTypeOf<
            Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>
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
        DecoratedMiddleware<InitialContext, { extra: boolean }, unknown, any, any, BaseMeta>
      >()

      // @ts-expect-error --- conflict context
      builder.middleware(({ next }) => next({ context: { db: undefined } }))
    })

    it('can type input and output', () => {
      expectTypeOf(
        builder.middleware(({ next }, input: 'input', output: MiddlewareOutputFn<'output'>) => next()),
      ).toEqualTypeOf<
        DecoratedMiddleware<InitialContext, Record<never, never>, 'input', 'output', any, BaseMeta>
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
      Builder<
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
  })

  describe('.use', () => {
    it('without map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors, signal }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<unknown>()
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()
        expectTypeOf(procedure).toEqualTypeOf<
          Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>
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
        BuilderWithMiddlewares<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      // @ts-expect-error --- Invalid TInContext
      builder.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>)
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}))
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}))
      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }))
    })

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, unknown, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        BuilderWithMiddlewares<
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

  it('.meta', () => {
    expectTypeOf(builder.meta({ log: true })).toEqualTypeOf<
      ProcedureBuilder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        MergedMeta<BaseMeta, { readonly log: true }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ log: 'INVALID' })
  })

  it('.meta accumulates new keys without re-specifying already-set fields', () => {
    expectTypeOf(builder.meta({ log: true }).meta({ mode: 'live' })).toEqualTypeOf<
      ProcedureBuilder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        MergedMeta<MergedMeta<BaseMeta, { readonly log: true }>, { readonly mode: 'live' }>,
        BaseMeta
      >
    >()
  })

  it('.meta overrides a previously-narrowed key, matching runtime merge', () => {
    expectTypeOf(builder.meta({ log: true }).meta({ log: false })).toEqualTypeOf<
      ProcedureBuilder<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        MergedMeta<MergedMeta<BaseMeta, { readonly log: true }>, { readonly log: false }>,
        BaseMeta
      >
    >()
  })

  it('.meta enforces declared schema even after narrowing', () => {
    // @ts-expect-error - 'INVALID' not assignable to log: boolean | undefined
    builder.meta({ log: true }).meta({ log: 'INVALID' })

    // @ts-expect-error - 'logg' is not in the declared schema
    builder.meta({ logg: true })
  })

  it('.meta supports helper composition with variable values via $meta', () => {
    type TabConfig = { id: string }
    const cfgA: TabConfig = { id: 'a' }
    const cfgB: TabConfig = { id: 'b' }

    const base = builder.$meta<{ tab?: TabConfig }>({})

    const result = base.meta({ tab: cfgA }).meta({ tab: cfgB })
    expectTypeOf(result['~orpc'].meta.tab).toEqualTypeOf<TabConfig>()

    // @ts-expect-error - foreign key rejected by the declared schema
    base.meta({ unknown: 1 })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ path: '/test', method: 'GET' })).toEqualTypeOf<
      ProcedureBuilder<
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

  it('.input', () => {
    expectTypeOf(builder.input(generalSchema)).toEqualTypeOf<
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof generalSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.input({})
  })

  it('.output', () => {
    expectTypeOf(builder.output(generalSchema)).toEqualTypeOf<
      ProcedureBuilderWithOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof generalSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.output({})
  })

  it('.handler', () => {
    const procedure = builder.handler(({ input, context, procedure, path, signal, errors }) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<CurrentContext>()
      expectTypeOf(path).toEqualTypeOf<readonly string[]>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()
      expectTypeOf(procedure).toEqualTypeOf<
        Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>
      >()
      expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

      return { output: 456 }
    })

    expectTypeOf(procedure).toMatchTypeOf<
      DecoratedProcedure<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        Schema<{ output: number }, { output: number }>,
        typeof baseErrorMap,
        BaseMeta
      >
    >()
  })

  it('.prefix', () => {
    expectTypeOf(builder.prefix('/test')).toEqualTypeOf<
      RouterBuilder<InitialContext, CurrentContext, typeof baseErrorMap, BaseMeta>
    >()

    // @ts-expect-error - invalid prefix
    builder.prefix(123)
  })

  it('.tag', () => {
    expectTypeOf(builder.tag('test', 'test2')).toEqualTypeOf<
      RouterBuilder<InitialContext, CurrentContext, typeof baseErrorMap, BaseMeta>
    >()
  })

  it('.router', () => {
    expectTypeOf(builder.router(router)).toEqualTypeOf<
      EnhancedRouter<typeof router, InitialContext, CurrentContext, typeof baseErrorMap>
    >()

    builder.router({
      // @ts-expect-error - initial context is not match
      ping: {} as Procedure<{ invalid: true }, any, any, any, any, any>,
    })

    builder.router({
      // @ts-expect-error - meta def is not match
      ping: {} as Procedure<
        any,
        any,
        any,
        any,
        any,
        { invalid: true }
      >,
    })
  })

  it('.lazy', () => {
    expectTypeOf(builder.lazy(() => Promise.resolve({ default: router }))).toEqualTypeOf<
      EnhancedRouter<Lazy<typeof router>, InitialContext, CurrentContext, typeof baseErrorMap>
    >()

    // @ts-expect-error - initial context is not match
    builder.lazy(() => Promise.resolve({
      default: {
        ping: {} as Procedure<{ invalid: true }, Context, AnySchema, AnySchema, Record<never, never>, BaseMeta>,
      },
    }))

    // @ts-expect-error - meta def is not match
    builder.lazy(() => Promise.resolve({
      default: {
        ping: {} as Procedure<
          Context,
          Context,
          AnySchema,
          AnySchema,
          Record<never, never>,
          { invalid: true }
        >,
      },
    }))
  })
})
