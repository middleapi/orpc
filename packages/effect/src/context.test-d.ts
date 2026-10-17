import type { InferEffectServices, WithEffectContext } from './context'
import { os } from '@orpc/server'
import { Context, Effect } from 'effect'
import { handlerGen } from './handler'
import { middlewareGen } from './middleware'

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

describe('InferEffectServices', () => {
  it('infers services from WithEffectContext', () => {
    expectTypeOf<InferEffectServices<WithEffectContext<Service1>>>().toEqualTypeOf<Service1>()
    expectTypeOf<InferEffectServices<WithEffectContext<Service1 | Service2>>>().toEqualTypeOf<Service1 | Service2>()
    expectTypeOf<InferEffectServices<WithEffectContext<never>>>().toEqualTypeOf<never>()
  })

  it('infers never for contexts without effect/context', () => {
    expectTypeOf<InferEffectServices<{ auth: boolean }>>().toEqualTypeOf<never>()
    expectTypeOf<InferEffectServices<object>>().toEqualTypeOf<never>()
  })

  it('infers unknown for any context', () => {
    expectTypeOf<InferEffectServices<any>>().toEqualTypeOf<unknown>()
  })

  it('infers services from intersection contexts', () => {
    expectTypeOf<InferEffectServices<WithEffectContext<Service1> & { auth: boolean }>>().toEqualTypeOf<Service1>()

    // shape produced when middleware extends effect/context
    expectTypeOf<
      InferEffectServices<WithEffectContext<Service1> & { 'effect/context': Context.Context<Service1 | Service2> }>
    >().toEqualTypeOf<Service1 | Service2>()
  })

  it('infers only services that every member of a union context provides', () => {
    expectTypeOf<InferEffectServices<WithEffectContext<Service1> | WithEffectContext<Service2>>>().toEqualTypeOf<never>()
    expectTypeOf<InferEffectServices<WithEffectContext<Service1> | { auth: boolean }>>().toEqualTypeOf<never>()
    expectTypeOf<InferEffectServices<WithEffectContext<Service1 | Service2> | WithEffectContext<Service1>>>().toEqualTypeOf<Service1>()
  })

  it('restricts yieldable services in handlerGen and middlewareGen for union contexts', () => {
    void os
      .$context<WithEffectContext<Service1> | WithEffectContext<Service2>>()
      // @ts-expect-error - Service1 is not provided by every member of the context
      .handler(handlerGen(function* () {
        yield* Service1
      }))

    void os
      .$context<WithEffectContext<Service1> | { auth: boolean }>()
      // @ts-expect-error - effect/context may be absent
      .use(middlewareGen(function* ({ next }) {
        yield* Service1
        return yield* next()
      }))

    void os
      .$context<WithEffectContext<Service1 | Service2> | WithEffectContext<Service1>>()
      .handler(handlerGen(function* () {
        yield* Service1
        return yield* Effect.succeed(1)
      }))
  })

  it('extends services through middleware', () => {
    void os
      .$context<WithEffectContext<Service1>>()
      .use(({ context, next }) => next({
        context: {
          'effect/context': context['effect/context'].pipe(Context.add(Service2, { id: 'Service2' })),
        },
      }))
      .handler(handlerGen(function* () {
        yield* Service1
        yield* Service2
      }))
  })
})
