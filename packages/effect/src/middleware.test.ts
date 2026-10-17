import type { WithEffectContext } from './context'
import { call, ORPCError, os } from '@orpc/server'
import { sleep } from '@orpc/shared'
import { Cause, Context, Effect, Option, References } from 'effect'
import { handlerGen } from './handler'
import { middlewareGen } from './middleware'
import * as EffectModule from './runtime'

const runPromiseSpy = vi.spyOn(EffectModule, 'runPromise')

beforeEach(() => {
  vi.clearAllMocks()
})

class Service1 extends Context.Service<
  Service1,
  {
    readonly id: 'Service1'
  }
>()('Service1') {}

class Service2 extends Context.Service<
  Service2,
  {
    readonly id: string
  }
>()('Service2') {}

describe('middlewareGen', () => {
  it('continues the chain and can extend the context', async () => {
    const procedure = os
      .$context<{ auth: boolean }>()
      .use(middlewareGen(function* ({ next }) {
        const random = yield* Effect.sync(() => 42)
        return yield* next({ context: { random } })
      }))
      .handler(({ context }) => `output:${context.random}`)

    await expect(
      call(procedure, undefined, { context: { auth: true } }),
    ).resolves.toEqual('output:42')
  })

  it('can terminate the chain early with done', async () => {
    const handlerFn = vi.fn(() => 'handler')

    const procedure = os
      .use(middlewareGen(function* (_, __, done) {
        return done({ output: 'early' })
      }))
      .handler(handlerFn)

    await expect(call(procedure)).resolves.toEqual('early')
    expect(handlerFn).not.toHaveBeenCalled()
  })

  it('can observe and recover downstream errors via the error channel', async () => {
    const error = new Error('__DOWNSTREAM__')

    const procedure = os
      .use(middlewareGen(function* ({ next }, _, done) {
        return yield* next().pipe(
          Effect.catch(() => Effect.sync(() => done({ output: 'recovered' }))),
        )
      }))
      .handler(() => {
        throw error
      })

    await expect(call(procedure)).resolves.toEqual('recovered')
  })

  it('preserves uncaught downstream errors as-is', async () => {
    const error = new Error('__DOWNSTREAM__')

    const procedure = os
      .use(middlewareGen(function* ({ next }) {
        return yield* next()
      }))
      .handler(() => {
        throw error
      })

    await expect(call(procedure)).rejects.toBe(error)
  })

  it('preserves middleware failures without fiber failure error wrapper', async () => {
    const error = new Error('__MIDDLEWARE__')

    const procedure = os
      .use(middlewareGen(function* ({ next }) {
        yield* Effect.fail(error)
        return yield* next()
      }))
      .handler(() => 'unreachable')

    await expect(call(procedure)).rejects.toBe(error)
  })

  it('propagates ORPCError thrown by the generator', async () => {
    const middleware = os
      .errors({ UNAUTHORIZED: {} })
      .middleware(middlewareGen(function* ({ errors }) {
        throw errors.UNAUTHORIZED()
      }))

    const procedure = os
      .use(middleware)
      .handler(() => 'unreachable')

    await expect(call(procedure)).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'UNAUTHORIZED' && error.defined,
    )
  })

  it('can access effect services from effect/context', async () => {
    const procedure = os
      .$context<WithEffectContext<Service1>>()
      .use(middlewareGen(function* ({ next }) {
        const service1 = yield* Service1
        return yield* next({ context: { fromService: service1.id } })
      }))
      .handler(({ context }) => `output:${context.fromService}`)

    await expect(call(
      procedure,
      undefined,
      { context: { 'effect/context': Context.empty().pipe(Context.add(Service1, { id: 'Service1' })) } },
    )).resolves.toEqual('output:Service1')
  })

  it('can wrap effect execution via effect/wrap', async () => {
    let wrappedCalls = 0

    const procedure = os
      .$context<WithEffectContext<never>>()
      .use(middlewareGen(function* ({ next }) {
        return yield* next()
      }))
      .handler(() => 'output')

    await expect(call(
      procedure,
      undefined,
      {
        context: {
          'effect/context': Context.empty(),
          'effect/wrap': effect => effect.pipe(Effect.tap(() => Effect.sync(() => {
            wrappedCalls += 1
          }))),
        },
      },
    )).resolves.toEqual('output')

    expect(wrappedCalls).toBe(1)
  })

  describe('interruption', () => {
    let log: string[] = []

    beforeEach(() => {
      log = []
    })

    const tracked = (name: string) => middlewareGen(function* ({ next }) {
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => log.push(`${name}-acquire`)),
        () => next(),
        () => Effect.sync(() => log.push(`${name}-release`)),
      )
    })

    const timeoutFallback = middlewareGen(function* ({ next }, _, done) {
      return yield* next().pipe(
        Effect.timeout('20 millis'),
        Effect.catchIf(Cause.isTimeoutError, () => Effect.sync(() => {
          log.push('mw-timeout')
          return done({ output: 'fallback' })
        })),
      )
    })

    it('waits for the downstream chain before running finalizers when the request aborts', async () => {
      const procedure = os
        .use(tracked('mw'))
        .handler(async ({ signal }) => {
          await sleep(50)
          log.push(`handler-done:aborted=${signal?.aborted}`)
          return 1
        })

      const signal = AbortSignal.timeout(10)
      await expect(call(procedure, undefined, { signal })).rejects.toSatisfy(error => error === signal.reason)
      expect(log).toEqual(['mw-acquire', 'handler-done:aborted=true', 'mw-release'])
    })

    it('unwinds nested middleware in order when the request aborts', async () => {
      const procedure = os
        .use(tracked('outer'))
        .use(async ({ next }) => {
          try {
            return await next()
          }
          finally {
            log.push('plain-finally')
          }
        })
        .use(tracked('inner'))
        .handler(async ({ signal }) => {
          await sleep(50)
          log.push(`handler-done:aborted=${signal?.aborted}`)
          return 1
        })

      await expect(call(procedure, undefined, { signal: AbortSignal.timeout(10) })).rejects.toThrow()
      expect(log).toEqual([
        'outer-acquire',
        'inner-acquire',
        'handler-done:aborted=true',
        'inner-release',
        'plain-finally',
        'outer-release',
      ])
    })

    it('interrupts a downstream handlerGen when the request aborts', async () => {
      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.ensuring(Effect.sync(() => log.push('mw-release'))),
          )
        }))
        .handler(handlerGen(function* () {
          return yield* Effect.never.pipe(
            Effect.onInterrupt(() => Effect.sleep('10 millis').pipe(
              Effect.andThen(Effect.sync(() => log.push('handler-interrupted'))),
            )),
          )
        }))

      const signal = AbortSignal.timeout(10)
      await expect(call(procedure, undefined, { signal })).rejects.toSatisfy(error => error === signal.reason)
      expect(log).toEqual(['handler-interrupted', 'mw-release'])
    })

    it('interrupts a downstream handlerGen when Effect.timeout interrupts next', async () => {
      const procedure = os
        .use(timeoutFallback)
        .handler(handlerGen(function* () {
          yield* Effect.sleep('1 second').pipe(
            Effect.onInterrupt(() => Effect.sync(() => log.push('handler-interrupted'))),
          )
          return 'handler'
        }))

      await expect(call(procedure)).resolves.toEqual('fallback')
      expect(log).toEqual(['handler-interrupted', 'mw-timeout'])
    })

    it('aborts the signal of a plain handler and waits for it when Effect.timeout interrupts next', async () => {
      const procedure = os
        .use(timeoutFallback)
        .handler(async ({ signal }) => {
          await new Promise(resolve => signal?.addEventListener('abort', resolve))
          await sleep(10)
          log.push('handler-aborted')
          throw new Error('dropped after interruption')
        })

      await expect(call(procedure)).resolves.toEqual('fallback')
      expect(log).toEqual(['handler-aborted', 'mw-timeout'])
    })

    it('closes an iterator returned by the downstream chain after interruption', async () => {
      const iteratorReturn = vi.fn(async () => ({ done: true as const, value: undefined }))

      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next()
        }))
        .handler(async () => {
          await sleep(30)
          return {
            next: async () => ({ done: true as const, value: undefined }),
            return: iteratorReturn,
            [Symbol.asyncIterator]() {
              return this
            },
          }
        })

      await expect(call(procedure, undefined, { signal: AbortSignal.timeout(10) })).rejects.toThrow()
      expect(iteratorReturn).toHaveBeenCalledTimes(1)
    })

    it('links a signal passed to next with interruption', async () => {
      const controller = new AbortController()
      let handlerSignal: AbortSignal | undefined

      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next({ signal: controller.signal })
        }))
        .handler(({ signal }) => {
          handlerSignal = signal
          return 'output'
        })

      await expect(call(procedure)).resolves.toEqual('output')
      expect(handlerSignal?.aborted).toBe(false)

      controller.abort()
      expect(handlerSignal?.aborted).toBe(true)
    })
  })

  describe('effect context propagation', () => {
    it('propagates services, spans and log annotations around next to downstream effects', async () => {
      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.provideService(Service1, { id: 'Service1' }),
            Effect.withSpan('mw-span'),
            Effect.annotateLogs({ requestId: 'req-1' }),
          )
        }))
        .handler(handlerGen(function* () {
          const service = yield* Effect.serviceOption(Service1)
          const span = yield* Effect.currentSpan
          const annotations = yield* References.CurrentLogAnnotations

          return { service: Option.getOrUndefined(service)?.id, span: span.name, annotations }
        }))

      await expect(call(procedure)).resolves.toEqual({
        service: 'Service1',
        span: 'mw-span',
        annotations: { requestId: 'req-1' },
      })
    })

    it('passes the propagated context through non-effect middleware', async () => {
      const procedure = os
        .$context<WithEffectContext<never>>()
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(Effect.provideService(Service1, { id: 'Service1' }))
        }))
        .use(({ context, next }) => next({
          context: { 'effect/context': context['effect/context'].pipe(Context.add(Service2, { id: 'Service2' })) },
        }))
        .handler(handlerGen(function* () {
          const service1 = yield* Effect.serviceOption(Service1)
          const service2 = yield* Effect.serviceOption(Service2)

          return [Option.getOrUndefined(service1)?.id, Option.getOrUndefined(service2)?.id]
        }))

      await expect(call(procedure, undefined, { context: { 'effect/context': Context.empty() } }))
        .resolves
        .toEqual(['Service1', 'Service2'])
    })

    it('layers an effect/context passed to next on top of the fiber context', async () => {
      const procedure = os
        .$context<WithEffectContext<Service1>>()
        .use(middlewareGen(function* ({ context, next }) {
          return yield* next({
            context: { 'effect/context': context['effect/context'].pipe(Context.add(Service2, { id: 'from-next' })) },
          }).pipe(
            Effect.provideService(Service2, { id: 'from-fiber' }),
            Effect.annotateLogs({ requestId: 'req-1' }),
          )
        }))
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          const service2 = yield* Service2
          const annotations = yield* References.CurrentLogAnnotations

          return { service1: service1.id, service2: service2.id, annotations }
        }))

      await expect(call(
        procedure,
        undefined,
        { context: { 'effect/context': Context.make(Service1, { id: 'Service1' }) } },
      )).resolves.toEqual({
        service1: 'Service1',
        service2: 'from-next',
        annotations: { requestId: 'req-1' },
      })
    })

    it('keeps the inner span and annotations when a nested middleware passes effect/context to next', async () => {
      const procedure = os
        .$context<WithEffectContext<Service1>>()
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.withSpan('outer'),
            Effect.annotateLogs({ who: 'outer' }),
          )
        }))
        .use(middlewareGen(function* ({ context, next }) {
          return yield* next({
            context: { 'effect/context': context['effect/context'].pipe(Context.add(Service2, { id: 'Service2' })) },
          }).pipe(
            Effect.withSpan('inner'),
            Effect.annotateLogs({ who: 'inner' }),
          )
        }))
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          const service2 = yield* Service2
          const span = yield* Effect.currentSpan
          const annotations = yield* References.CurrentLogAnnotations

          return { service1: service1.id, service2: service2.id, span: span.name, annotations }
        }))

      await expect(call(
        procedure,
        undefined,
        { context: { 'effect/context': Context.make(Service1, { id: 'Service1' }) } },
      )).resolves.toEqual({
        service1: 'Service1',
        service2: 'Service2',
        span: 'inner',
        annotations: { who: 'inner' },
      })
    })

    it('lets effect/context passed to next override an incoming service', async () => {
      const procedure = os
        .$context<WithEffectContext<Service2>>()
        .use(middlewareGen(function* ({ context, next }) {
          return yield* next({
            context: { 'effect/context': context['effect/context'].pipe(Context.add(Service2, { id: 'overridden' })) },
          })
        }))
        .handler(handlerGen(function* () {
          return (yield* Service2).id
        }))

      await expect(call(
        procedure,
        undefined,
        { context: { 'effect/context': Context.make(Service2, { id: 'incoming' }) } },
      )).resolves.toEqual('overridden')
    })

    it('nests effect/wrap spans of downstream effects under the middleware span', async () => {
      let index = 0

      const procedure = os
        .$context<WithEffectContext<never>>()
        .use(middlewareGen(function* ({ next }) {
          return yield* next()
        }))
        .handler(handlerGen(function* () {
          const span = yield* Effect.currentSpan
          const parent = Option.getOrUndefined(span.parent)

          return [span.name, parent?._tag === 'Span' ? parent.name : undefined]
        }))

      await expect(call(procedure, undefined, {
        context: {
          'effect/context': Context.empty(),
          'effect/wrap': effect => effect.pipe(Effect.withSpan(`wrap-${index++}`)),
        },
      })).resolves.toEqual(['wrap-1', 'wrap-0'])
    })
  })

  it('forwards the provided signal to runPromise', async () => {
    const controller = new AbortController()

    const procedure = os
      .use(middlewareGen(function* ({ next }) {
        return yield* next()
      }))
      .handler(() => 'output')

    await expect(
      call(procedure, undefined, { signal: controller.signal }),
    ).resolves.toEqual('output')

    expect(runPromiseSpy).toHaveBeenCalledTimes(1)
    expect(runPromiseSpy).toHaveBeenNthCalledWith(1, expect.anything(), { signal: controller.signal })
  })
})
