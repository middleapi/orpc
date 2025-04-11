import type { AnySchema, ContractProcedure, ErrorMap, MergedErrorMap, Schema } from '@orpc/contract'
import type { OmitChainMethodDeep } from '@orpc/shared'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Builder } from './builder'
import type { BuilderWithMiddlewares, ProcedureBuilder, ProcedureBuilderWithInput, ProcedureBuilderWithInputOutput, ProcedureBuilderWithOutput, RouterBuilder } from './builder-variants'
import type { Context } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { Lazy } from './lazy'
import type { Middleware, MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { DecoratedProcedure } from './procedure-decorated'
import type { EnhancedRouter } from './router-utils'
import { generalSchema } from '../../contract/tests/shared'
import { router } from '../tests/shared'

const generalBuilder = {} as Builder<
  InitialContext,
  CurrentContext,
    typeof inputSchema,
    typeof outputSchema,
    typeof baseErrorMap,
    BaseMeta
>

describe('BuilderWithMiddlewares', () => {
  const builder = {} as BuilderWithMiddlewares<
    InitialContext,
    CurrentContext,
      typeof inputSchema,
      typeof outputSchema,
      typeof baseErrorMap,
      BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
            typeof generalBuilder,
            '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware'
    >

    // expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

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

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      BuilderWithMiddlewares<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
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

      // @ts-expect-error --- invalid TInContext
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
      BuilderWithMiddlewares<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
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

    // @ts-expect-error - schema is invalid
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

    // @ts-expect-error - schema is invalid
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
        ping: {} as Procedure<{ invalid: true }, any, any, any, any, any>,
      },
    }))

    // @ts-expect-error - meta def is not match
    builder.lazy(() => Promise.resolve({
      default: {
        ping: {} as Procedure<
          any,
          any,
          any,
          any,
          any,
          { invalid: true }
        >,
      },
    }))
  })
})

describe('ProcedureBuilder', () => {
  const builder = {} as ProcedureBuilder<
    InitialContext,
    CurrentContext,
    typeof inputSchema,
    typeof outputSchema,
    typeof baseErrorMap,
    BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
        typeof generalBuilder,
        '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware' | 'prefix' | 'tag' | 'router' | 'lazy'
    >

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

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

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ProcedureBuilder<
        InitialContext,
        CurrentContext,
          typeof inputSchema,
          typeof outputSchema,
          MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
          BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
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
        ProcedureBuilder<
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

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, unknown, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        ProcedureBuilder<
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
          BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
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

    // @ts-expect-error - schema is invalid
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

    // @ts-expect-error - schema is invalid
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
})

describe('ProcedureBuilderWithInput', () => {
  const builder = {} as ProcedureBuilderWithInput<
    InitialContext,
    CurrentContext,
    typeof inputSchema,
    typeof outputSchema,
    typeof baseErrorMap,
    BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
      typeof generalBuilder,
      '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware' | 'prefix' | 'tag' | 'router' | 'lazy' | 'input'
    >

    expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

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

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
  })

  describe('.use', () => {
    it('without map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors, signal }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()
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
        ProcedureBuilderWithInput<
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
      const applied = builder.use(({ context, next, path, procedure, errors, signal }, input: { mapped: boolean }, output) => {
        expectTypeOf(input).toEqualTypeOf<{ mapped: boolean }>()
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
      }, (input) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()

        return { mapped: true }
      })

      expectTypeOf(applied).toEqualTypeOf<
        ProcedureBuilderWithInput<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      builder.use(
        ({ context, next, path, procedure, errors, signal }, input: { mapped: boolean }, output) => next(),
        // @ts-expect-error --- invalid map input
        input => ({ invalid: true }),
      )

      // @ts-expect-error --- invalid TInContext
      builder.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>, () => {})
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}), input => ({ mapped: true }))
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}), input => ({ mapped: true }))
      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }), () => { })
    })

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, unknown, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        ProcedureBuilderWithInput<
          InitialContext & { cacheable?: boolean },
          Omit<CurrentContext, never> & Record<never, never>,
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      expectTypeOf(builder.use(mid, () => { })).toEqualTypeOf<
        ProcedureBuilderWithInput<
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
      ProcedureBuilderWithInput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
      ProcedureBuilderWithInput<
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

  it('.output', () => {
    expectTypeOf(builder.output(generalSchema)).toEqualTypeOf<
      ProcedureBuilderWithInputOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof generalSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.output({})
  })

  it('.handler', () => {
    const procedure = builder.handler(({ input, context, procedure, path, signal, errors }) => {
      expectTypeOf(input).toEqualTypeOf<{ input: string }>()
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
})

describe('ProcedureBuilderWithOutput', () => {
  const builder = {} as ProcedureBuilderWithOutput<
    InitialContext,
    CurrentContext,
    typeof inputSchema,
    typeof outputSchema,
    typeof baseErrorMap,
    BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
      typeof generalBuilder,
      '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware' | 'prefix' | 'tag' | 'router' | 'lazy' | 'output'
    >

    // expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

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

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ProcedureBuilderWithOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
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
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<{ output: number }>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
        expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

        return next({
          context: {
            extra: true,
          },
        })
      })

      expectTypeOf(applied).toEqualTypeOf<
        ProcedureBuilderWithOutput<
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

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, any, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        ProcedureBuilderWithOutput<
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
      ProcedureBuilderWithOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
      ProcedureBuilderWithOutput<
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
      ProcedureBuilderWithInputOutput<
        InitialContext,
        CurrentContext,
        typeof generalSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.input({})
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
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error --- invalid output
    builder.handler(() => ({ output: 'invalid' }))
  })
})

describe('ProcedureBuilderWithInputOutput', () => {
  const builder = {} as ProcedureBuilderWithInputOutput<
    InitialContext,
    CurrentContext,
    typeof inputSchema,
    typeof outputSchema,
    typeof baseErrorMap,
    BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
      typeof generalBuilder,
      '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware' | 'prefix' | 'tag' | 'router' | 'lazy' | 'input' | 'output'
    >

    // expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
  })

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

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' }, OVERRIDE: { message: 'override' } })).toEqualTypeOf<
      ProcedureBuilderWithInputOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<typeof baseErrorMap, { INVALID: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
  })

  describe('.use', () => {
    it('without map input', () => {
      const applied = builder.use(({ context, next, path, procedure, errors, signal }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()
        expectTypeOf(procedure).toEqualTypeOf<
          Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>
        >()
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<{ output: number }>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
        expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

        return next({
          context: {
            extra: true,
          },
        })
      })

      expectTypeOf(applied).toEqualTypeOf<
        ProcedureBuilderWithInputOutput<
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
      const applied = builder.use(({ context, next, path, procedure, errors, signal }, input: { mapped: boolean }, output) => {
        expectTypeOf(input).toEqualTypeOf<{ mapped: boolean }>()
        expectTypeOf(context).toEqualTypeOf<CurrentContext>()
        expectTypeOf(path).toEqualTypeOf<readonly string[]>()
        expectTypeOf(procedure).toEqualTypeOf<
          Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta>
        >()
        expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<{ output: number }>>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()
        expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

        return next({
          context: {
            extra: true,
          },
        })
      }, (input) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>()

        return { mapped: true }
      })

      expectTypeOf(applied).toEqualTypeOf<
        ProcedureBuilderWithInputOutput<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      builder.use(
        ({ context, next, path, procedure, errors, signal }, input: { mapped: boolean }, output) => next(),
        // @ts-expect-error --- invalid map input
        input => ({ invalid: true }),
      )

      // @ts-expect-error --- invalid TInContext
      builder.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>, () => {})
      // @ts-expect-error --- input is not match
      builder.use(({ next }, input: 'invalid') => next({}), input => ({ mapped: true }))
      // @ts-expect-error --- output is not match
      builder.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}), input => ({ mapped: true }))
      // @ts-expect-error --- conflict context
      builder.use(({ next }) => next({ context: { db: undefined } }), input => ({ mapped: true }))
    })

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, any, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        ProcedureBuilderWithInputOutput<
          InitialContext & { cacheable?: boolean },
          Omit<CurrentContext, never> & Record<never, never>,
          typeof inputSchema,
          typeof outputSchema,
          typeof baseErrorMap,
          BaseMeta
        >
      >()

      expectTypeOf(builder.use(mid, () => { })).toEqualTypeOf<
        ProcedureBuilderWithInputOutput<
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
      ProcedureBuilderWithInputOutput<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid meta
    builder.meta({ meta: 'INVALID' })
  })

  it('.route', () => {
    expectTypeOf(builder.route({ method: 'GET' })).toEqualTypeOf<
      ProcedureBuilderWithInputOutput<
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

  it('.handler', () => {
    const procedure = builder.handler(({ input, context, procedure, path, signal, errors }) => {
      expectTypeOf(input).toEqualTypeOf<{ input: string }>()
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
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >()

    // @ts-expect-error --- invalid output
    builder.handler(() => ({ output: 'invalid' }))
  })
})

describe('RouterBuilder', () => {
  const builder = {} as RouterBuilder<
    InitialContext,
    CurrentContext,
    typeof baseErrorMap,
    BaseMeta
  >

  it('backward compatibility', () => {
    const expected = {} as OmitChainMethodDeep<
      typeof generalBuilder,
      '$config' | '$context' | '$meta' | '$route' | '$input' | 'middleware' | 'meta' | 'route' | 'input' | 'output' | 'handler'
    >

    // expectTypeOf(builder).toMatchTypeOf(expected)
    expectTypeOf<keyof typeof builder>().toEqualTypeOf<keyof typeof expected>()
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
        RouterBuilder<
          InitialContext & Record<never, never>,
          Omit<CurrentContext, 'extra'> & { extra: boolean },
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

    it('with TInContext', () => {
      const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, unknown, ORPCErrorConstructorMap<any>, BaseMeta>

      expectTypeOf(builder.use(mid)).toEqualTypeOf<
        RouterBuilder<
              InitialContext & { cacheable?: boolean },
              Omit<CurrentContext, never> & Record<never, never>,
              typeof baseErrorMap,
              BaseMeta
        >
      >()
    })
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
        ping: {} as Procedure<{ invalid: true }, any, any, any, any, any>,
      },
    }))

    // @ts-expect-error - meta def is not match
    builder.lazy(() => Promise.resolve({
      default: {
        ping: {} as Procedure<
          any,
          any,
          any,
          any,
          any,
          { invalid: true }
        >,
      },
    }))
  })
})
