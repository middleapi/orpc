import type { AnySchema, ErrorMap, Meta, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema, router } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext } from '../tests/shared'
import type { Context, MergedCurrentContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { ImplementerInternal } from './implementer'
import type { ProcedureImplementer } from './implementer-procedure'
import type { ImplementerInternalWithMiddlewares } from './implementer-variants'
import type { Lazy } from './lazy'
import type { Middleware, MiddlewareOutputFn } from './middleware'
import type { Procedure } from './procedure'
import type { EnhancedRouter } from './router-utils'
import { router as implRouter } from '../tests/shared'

describe('ImplementerWithMiddlewares', () => {
  const implementer = {} as ImplementerInternalWithMiddlewares<typeof router, InitialContext, CurrentContext>
  it('backwards compatibility with Implementer', () => {
    const _: typeof implementer = {} as ImplementerInternal<typeof router, InitialContext, CurrentContext>
  })

  describe('router level', () => {
    describe('.use', () => {
      it('without map input', () => {
        const applied = implementer.nested.use(({ context, next, path, procedure, errors, signal }, input, output) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<CurrentContext>()
          expectTypeOf(path).toEqualTypeOf<readonly string[]>()
          expectTypeOf(procedure).toEqualTypeOf<
            Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, BaseMeta | Meta>
          >()
          expectTypeOf(output).toEqualTypeOf<MiddlewareOutputFn<unknown>>()
          expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof baseErrorMap | Record<never, never>>>()
          expectTypeOf(signal).toEqualTypeOf<undefined | InstanceType<typeof AbortSignal>>()

          return next({
            context: {
              extra: true,
            },
          })
        })

        expectTypeOf(applied).toEqualTypeOf<
          ImplementerInternalWithMiddlewares<
          typeof router['nested'],
          InitialContext & Record<never, never>,
          MergedCurrentContext<CurrentContext, { extra: boolean }>
          >
        >()

        // @ts-expect-error --- invalid TInContext
        implementer.nested.use({} as Middleware<{ auth: 'invalid' }, any, any, any, any, any>)
        // @ts-expect-error --- input is not match
        implementer.use(({ next }, input: 'invalid') => next({}))
        // @ts-expect-error --- output is not match
        implementer.use(({ next }, input, output: MiddlewareOutputFn<'invalid'>) => next({}))
        // @ts-expect-error --- conflict context
        implementer.use(({ next }) => next({ context: { db: undefined } }))
      })

      it('with TInContext', () => {
        const mid = {} as Middleware<{ cacheable?: boolean } & Record<never, never>, Record<never, never>, unknown, unknown, ORPCErrorConstructorMap<any>, BaseMeta>

        expectTypeOf(implementer.use(mid)).toEqualTypeOf<
          ImplementerInternalWithMiddlewares<
              typeof router,
              InitialContext & { cacheable?: boolean },
              Omit<CurrentContext, never> & Record<never, never>
          >
        >()
      })
    })

    it('.router', () => {
      expectTypeOf(implementer.router(implRouter)).toEqualTypeOf<
        EnhancedRouter <typeof implRouter, InitialContext, CurrentContext, Record<never, never>>
      >()

      implementer.router({
        // @ts-expect-error - initial context is not match
        ping: {} as Procedure<
          { invalid: true },
          Context,
          AnySchema,
          AnySchema,
          Record<never, never>,
          BaseMeta
        >,
      })

      implementer.router({
        // @ts-expect-error - meta def is not match
        ping: {} as Procedure<
          Context,
          Context,
          AnySchema,
          AnySchema,
          Record<never, never>,
          { invalid: true }
        >,
      })

      // @ts-expect-error - missing implementation
      implementer.router({
        ping: implRouter.ping,
      })
    })

    it('.lazy', () => {
      expectTypeOf(implementer.lazy(() => Promise.resolve({ default: implRouter }))).toEqualTypeOf<
        EnhancedRouter<Lazy<typeof implRouter>, InitialContext, CurrentContext, Record<never, never>>
      >()

      // @ts-expect-error - initial context is not match
      implementer.lazy(() => Promise.resolve({
        default: {
          ping: {} as Procedure<
            { invalid: true },
            Context,
            AnySchema,
            AnySchema,
            Record<never, never>,
            BaseMeta
          >,
        },
      }))

      // @ts-expect-error - meta def is not match
      implementer.lazy(() => Promise.resolve({
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

      // @ts-expect-error - missing implementation
      implementer.lazy(() => Promise.resolve({
        default: {
          ping: implRouter.ping,
        },
      }))
    })
  })

  it('each procedure is a ProcedureImplementer', () => {
    type ExpectedPing = ProcedureImplementer<
        InitialContext,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap,
        BaseMeta
      >

    type ExpectedPong = ProcedureImplementer<
        InitialContext,
        CurrentContext,
        Schema<unknown, unknown>,
        Schema<unknown, unknown>,
        Record<never, never>,
        Meta
      >

    expectTypeOf(implementer.ping).toEqualTypeOf<ExpectedPing>()
    expectTypeOf(implementer.nested.ping).toEqualTypeOf<ExpectedPing>()
    expectTypeOf(implementer.pong).toEqualTypeOf<ExpectedPong>()
    expectTypeOf(implementer.nested.pong).toEqualTypeOf<ExpectedPong>()
  })
})
