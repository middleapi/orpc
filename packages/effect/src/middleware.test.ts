import type { WithEffectContext } from './context'
import { call, ORPCError, os } from '@orpc/server'
import { sleep } from '@orpc/shared'
import { Context, Effect, Option, References } from 'effect'
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

  describe('interruption', () => {
    it('waits for the downstream chain to settle before running finalizers on abort', async () => {
      const log: string[] = []

      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => log.push('mw-acquire')),
            () => next(),
            () => Effect.sync(() => log.push('mw-release')),
          )
        }))
        .handler(async () => {
          await sleep(50)
          log.push('handler-done')
          return 1
        })

      const signal = AbortSignal.timeout(10)
      await expect(call(procedure, undefined, { signal }).finally(() => log.push('call-settled'))).rejects.toSatisfy(error => error === signal.reason)

      expect(log).toEqual(['mw-acquire', 'handler-done', 'mw-release', 'call-settled'])
    })

    it('aborts the downstream signal with the request reason on abort', async () => {
      const log: string[] = []
      let handlerSignal: AbortSignal | undefined

      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.ensuring(Effect.sync(() => log.push('mw-finalized'))),
          )
        }))
        .handler(async ({ signal }) => {
          handlerSignal = signal
          await new Promise(resolve => signal?.addEventListener('abort', resolve))
          await sleep(10)
          log.push('handler-aborted')
          throw signal?.reason
        })

      const controller = new AbortController()
      const promise = call(procedure, undefined, { signal: controller.signal })
      await sleep(10)
      controller.abort(new Error('__ABORT__'))

      await expect(promise).rejects.toThrow('__ABORT__')
      expect(handlerSignal?.reason).toBe(controller.signal.reason)
      expect(log).toEqual(['handler-aborted', 'mw-finalized'])
    })

    it('interrupts a downstream effectful handler before running finalizers on abort', async () => {
      const log: string[] = []

      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.ensuring(Effect.sync(() => log.push('mw-finalized'))),
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

      expect(log).toEqual(['handler-interrupted', 'mw-finalized'])
    })

    it('interrupts the downstream chain when a combinator interrupts next()', async () => {
      const log: string[] = []
      const handler = vi.fn(handlerGen(function* () {
        yield* Effect.never.pipe(
          Effect.onInterrupt(() => Effect.sync(() => log.push('handler-interrupted'))),
        )
        return 'unreachable'
      }))

      const procedure = os
        .use(middlewareGen(function* ({ next }, _, done) {
          const result = yield* next().pipe(Effect.timeoutOption('20 millis'))
          log.push('mw-timeout')
          return Option.getOrElse(result, () => done({ output: 'timeout' }))
        }))
        .handler(handler)

      const signal = new AbortController().signal
      await expect(call(procedure, undefined, { signal })).resolves.toBe('timeout')

      expect(log).toEqual(['handler-interrupted', 'mw-timeout'])
      expect(signal.aborted).toBe(false)
      expect(handler.mock.calls[0]![0].signal).not.toBe(signal)
      expect(handler.mock.calls[0]![0].signal?.aborted).toBe(true)
    })

    it('cascades interruption through nested effectful middleware in order', async () => {
      const log: string[] = []

      const procedure = os
        .use(middlewareGen(function* ({ next }, _, done) {
          const result = yield* next().pipe(Effect.timeoutOption('20 millis'))
          log.push('outer-timeout')
          return Option.getOrElse(result, () => done({ output: 'timeout' }))
        }))
        .use(middlewareGen(function* ({ next }) {
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => log.push('inner-acquire')),
            () => next(),
            () => Effect.sync(() => log.push('inner-release')),
          )
        }))
        .handler(handlerGen(function* () {
          yield* Effect.never.pipe(
            Effect.onInterrupt(() => Effect.sync(() => log.push('handler-interrupted'))),
          )
          return 'unreachable'
        }))

      await expect(call(procedure)).resolves.toBe('timeout')
      expect(log).toEqual(['inner-acquire', 'handler-interrupted', 'inner-release', 'outer-timeout'])
    })

    it('releases an iterator returned after next() was interrupted', async () => {
      const iterator = (async function* () {})()
      const returnSpy = vi.spyOn(iterator, 'return')

      const procedure = os
        .use(middlewareGen(function* ({ next }, _, done) {
          const result = yield* next().pipe(Effect.timeoutOption('10 millis'))
          return Option.getOrElse(result, () => done({ output: 'timeout' }))
        }))
        .handler(async () => {
          await sleep(30)
          return iterator
        })

      await expect(call(procedure)).resolves.toBe('timeout')
      expect(returnSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('effect context propagation', () => {
    it('propagates services, spans and log annotations to downstream effectful handlers', async () => {
      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(
            Effect.provideService(Service2, { id: 'from-middleware' }),
            Effect.annotateLogs({ requestId: '__REQUEST_ID__' }),
            Effect.withSpan('mw-span'),
          )
        }))
        .handler(handlerGen(function* () {
          const service = yield* Effect.serviceOption(Service2)
          const span = yield* Effect.currentParentSpan
          const annotations = yield* References.CurrentLogAnnotations

          return {
            service: Option.getOrUndefined(service)?.id,
            span: span._tag === 'Span' ? span.name : undefined,
            annotations,
          }
        }))

      await expect(call(procedure)).resolves.toEqual({
        service: 'from-middleware',
        span: 'mw-span',
        annotations: { requestId: '__REQUEST_ID__' },
      })
    })

    it('propagates through non-effect middleware', async () => {
      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next().pipe(Effect.provideService(Service2, { id: 'from-middleware' }))
        }))
        .use(({ next }) => next({ context: { plain: true } }))
        .handler(handlerGen(function* ({ context }) {
          const service = yield* Effect.serviceOption(Service2)
          return `${Option.getOrUndefined(service)?.id}:${context.plain}`
        }))

      await expect(call(procedure)).resolves.toEqual('from-middleware:true')
    })

    it('layers an explicitly passed effect/context on top of the fiber context', async () => {
      const procedure = os
        .$context<WithEffectContext<Service1>>()
        .use(middlewareGen(function* ({ context, next }) {
          return yield* next({
            context: {
              'effect/context': context['effect/context'].pipe(
                Context.add(Service2, { id: 'from-next' }),
              ),
            },
          }).pipe(Effect.provideService(Service2, { id: 'from-fiber' }))
        }))
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          const service2 = yield* Effect.serviceOption(Service2)
          const annotations = yield* References.CurrentLogAnnotations
          return { service1: service1.id, service2: Option.getOrUndefined(service2)?.id, annotations }
        }))

      await expect(call(procedure, undefined, {
        context: {
          'effect/context': Context.make(Service1, { id: 'Service1' }),
        },
      })).resolves.toEqual({ service1: 'Service1', service2: 'from-next', annotations: {} })
    })

    it('keeps an explicitly passed effect/context alongside fiber services', async () => {
      const procedure = os
        .use(middlewareGen(function* ({ next }) {
          return yield* next({
            context: { 'effect/context': Context.make(Service1, { id: 'Service1' }) },
          }).pipe(
            Effect.provideService(Service2, { id: 'from-fiber' }),
            Effect.annotateLogs({ requestId: '__REQUEST_ID__' }),
          )
        }))
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          const service2 = yield* Effect.serviceOption(Service2)
          const annotations = yield* References.CurrentLogAnnotations
          return { service1: service1.id, service2: Option.getOrUndefined(service2)?.id, annotations }
        }))

      await expect(call(procedure)).resolves.toEqual({
        service1: 'Service1',
        service2: 'from-fiber',
        annotations: { requestId: '__REQUEST_ID__' },
      })
    })
  })
})
