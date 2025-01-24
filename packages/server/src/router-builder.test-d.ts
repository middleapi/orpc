import type { ErrorMap, MergedErrorMap, ORPCErrorConstructorMap, Route, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta } from '../../contract/tests/shared'
import type { Context } from './context'
import type { Lazy } from './lazy'
import type { MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { AdaptedRouter } from './router'
import type { RouterBuilder } from './router-builder'
import { type CurrentContext, type InitialContext, router } from '../tests/shared'

const builder = {} as RouterBuilder<InitialContext, CurrentContext, typeof baseErrorMap, BaseMeta>

describe('RouterBuilder', () => {
  it('.prefix', () => {
    expectTypeOf(builder.prefix('/test')).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid prefix
    builder.prefix('')
    // @ts-expect-error - invalid prefix
    builder.prefix(1)
  })

  it('.tag', () => {
    expectTypeOf(builder.tag('test')).toEqualTypeOf<typeof builder>()
    expectTypeOf(builder.tag('test', 'test2', 'test3')).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid tag
    builder.tag(1)
    // @ts-expect-error - invalid tag
    builder.tag('123', 2)
  })

  it('.errors', () => {
    expectTypeOf(
      builder.errors({
        BAD_GATEWAY: { message: 'BAD' },
        OVERRIDE: { message: 'OVERRIDE' },
      }),
    ).toEqualTypeOf<
      RouterBuilder<
        InitialContext,
        CurrentContext,
        MergedErrorMap<typeof baseErrorMap, { BAD_GATEWAY: { message: string }, OVERRIDE: { message: string } }>,
        BaseMeta
      >
    >()

    // @ts-expect-error - invalid schema
    builder.errors({ BAD_GATEWAY: { data: {} } })
  })

  it('.use', () => {
    const applied = builder.use(({ next, context, path, procedure, signal, errors }, input, output) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<CurrentContext>()
      expectTypeOf(path).toEqualTypeOf<string[]>()
      expectTypeOf(procedure).toEqualTypeOf<
        Procedure<Context, Context, Schema, Schema, unknown, ErrorMap, BaseMeta>
      >()
      expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<unknown>>()
      expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()
      expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap>>()

      return next({
        context: {
          extra: true,
        },
      })
    })

    expectTypeOf(applied).toEqualTypeOf<
      RouterBuilder<
        InitialContext,
        CurrentContext & { extra: boolean },
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

  it('.router', () => {
    expectTypeOf(builder.router(router)).toEqualTypeOf<
      AdaptedRouter<
        typeof router,
        InitialContext,
        typeof baseErrorMap
      >
    >()

    builder.router({
      // @ts-expect-error - initial context is not match
      ping: {} as Procedure<{ invalid: true }, Context, undefined, undefined, unknown, Record<never, never>, BaseMeta>,
    })

    builder.router({
      // @ts-expect-error - meta def is not match
      ping: {} as Procedure<Context, Context, undefined, undefined, unknown, Record<never, never>, Route, { invalid?: true }, { invalid: true }>,
    })
  })

  it('.lazy', () => {
    expectTypeOf(builder.lazy(() => Promise.resolve({ default: router }))).toEqualTypeOf<
      AdaptedRouter<
        Lazy<typeof router>,
        InitialContext,
        typeof baseErrorMap
      >
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
