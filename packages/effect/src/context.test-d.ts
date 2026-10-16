import type { AnyProcedure, Context as ORPCContext, ORPCErrorConstructorMap } from '@orpc/server'
import type { EffectWrapHandlerOptions, EffectWrapMiddlewareOptions, EffectWrapOptions, InferEffectServices, WithEffectContext } from './context'
import { ORPCError } from '@orpc/server'
import { Cause, Context, Effect } from 'effect'

class Service1 extends Context.Service<
  Service1,
  {
    readonly id: 'Service1'
  }
>()('Service1') {}

class Service2 extends Context.Service<
  Service2,
  {
    readonly id: 'Service2'
  }
>()('Service2') {}

type Wrap = NonNullable<WithEffectContext<Service1>['effect/wrap']>

describe('WithEffectContext', () => {
  it('effect/context', () => {
    expectTypeOf<WithEffectContext<Service1>['effect/context']>().toEqualTypeOf<Context.Context<Service1>>()
  })

  describe('effect/wrap', () => {
    it('keeps the success type and allows changing the error type', () => {
      const mapError: Wrap = effect => effect.pipe(
        Effect.mapError(error => new ORPCError('BAD_REQUEST', { cause: error })),
      )

      const catchCause: Wrap = effect => effect.pipe(
        Effect.catchCause(cause => Effect.fail(new ORPCError('INTERNAL_SERVER_ERROR', { cause: Cause.squash(cause) }))),
      )

      const fail: Wrap = () => Effect.fail(new ORPCError('UNAUTHORIZED'))

      void mapError
      void catchCause
      void fail

      // @ts-expect-error - must keep the success type
      const invalidSuccess: Wrap = effect => effect.pipe(Effect.as('invalid'))
      void invalidSuccess
    })

    it('does not allow requiring services', () => {
      // services from effect/context are available at runtime, but must be read without requirements
      const serviceOption: Wrap = effect => Effect.serviceOption(Service1).pipe(Effect.andThen(effect))
      void serviceOption

      // @ts-expect-error - wrap cannot require services
      const requireService: Wrap = effect => Effect.gen(function* () {
        yield* Service2
        return yield* effect
      })
      void requireService
    })

    it('receives options discriminated by kind', () => {
      const wrap: Wrap = (effect, opts) => {
        expectTypeOf(opts).toEqualTypeOf<EffectWrapOptions>()
        expectTypeOf(opts.kind).toEqualTypeOf<'middleware' | 'handler'>()
        expectTypeOf(opts.context).toEqualTypeOf<ORPCContext>()
        expectTypeOf(opts.input).toEqualTypeOf<unknown>()
        expectTypeOf(opts.path).toEqualTypeOf<string[]>()
        expectTypeOf(opts.procedure).toExtend<AnyProcedure>()
        expectTypeOf(opts.signal).toEqualTypeOf<AbortSignal | undefined>()
        expectTypeOf(opts.lastEventId).toEqualTypeOf<string | undefined>()
        expectTypeOf(opts.errors).toEqualTypeOf<ORPCErrorConstructorMap<any>>()

        if (opts.kind === 'middleware') {
          expectTypeOf(opts).toEqualTypeOf<EffectWrapMiddlewareOptions>()
          expectTypeOf(opts).not.toHaveProperty('next')
        }
        else {
          expectTypeOf(opts).toEqualTypeOf<EffectWrapHandlerOptions>()
        }

        return effect.pipe(Effect.withSpan(`${opts.kind}:${opts.path.join('.')}`))
      }

      void wrap
    })
  })
})

describe('InferEffectServices', () => {
  it('infers services from effect/context', () => {
    expectTypeOf<InferEffectServices<WithEffectContext<Service1 | Service2>>>().toEqualTypeOf<Service1 | Service2>()
    expectTypeOf<InferEffectServices<WithEffectContext<never>>>().toEqualTypeOf<never>()
    expectTypeOf<InferEffectServices<{ auth: boolean }>>().toEqualTypeOf<never>()
  })

  it('accepts a context with more services than required', () => {
    expectTypeOf<WithEffectContext<Service1 | Service2>>().toExtend<WithEffectContext<Service1>>()
  })
})
