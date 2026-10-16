import type { EffectWrapOptions, WithEffectContext } from './context'
import { call, ORPCError, os } from '@orpc/server'
import { Context, Effect, Option, Tracer } from 'effect'
import { z } from 'zod'
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
    const wrapOptions: EffectWrapOptions[] = []
    const wrap: WithEffectContext<never>['effect/wrap'] = (effect, opts) => {
      wrapOptions.push(opts)
      return effect
    }

    const procedure = os
      .$context<WithEffectContext<never>>()
      .input(z.object({ id: z.string().transform(Number) }))
      .errors({ BASE: {} })
      .use(middlewareGen(function* ({ next }) {
        return yield* next()
      }))
      .handler(() => 'output')

    const signal = AbortSignal.timeout(100)
    const context = { 'effect/context': Context.empty(), 'effect/wrap': wrap }

    await expect(call(
      procedure,
      { id: '1' },
      { path: ['wrapped', 'procedure'], context, signal, lastEventId: 'id' },
    )).resolves.toEqual('output')

    expect(wrapOptions).toEqual([{
      kind: 'middleware',
      context,
      // validated input of the middleware rather than the raw procedure input
      input: { id: 1 },
      path: ['wrapped', 'procedure'],
      procedure,
      signal,
      lastEventId: 'id',
      errors: { BASE: expect.any(Function) },
    }])
    expect(wrapOptions[0]).not.toHaveProperty('next')
  })

  it('invokes effect/wrap once per middlewareGen and handlerGen', async () => {
    const wrapOptions: EffectWrapOptions[] = []
    const wrap: WithEffectContext<never>['effect/wrap'] = (effect, opts) => {
      wrapOptions.push(opts)
      return effect
    }

    const procedure = os
      .$context<WithEffectContext<never>>()
      .use(middlewareGen(function* ({ next }) {
        return yield* next({ context: { first: true } })
      }))
      .use(({ next }) => next({ context: { plain: true } }))
      .use(middlewareGen(function* ({ next }) {
        return yield* next({ context: { second: true } })
      }))
      .handler(handlerGen(function* () {
        return 'output'
      }))

    await expect(call(procedure, undefined, {
      context: { 'effect/context': Context.empty(), 'effect/wrap': wrap },
    })).resolves.toEqual('output')

    expect(wrapOptions.map(opts => [opts.kind, Object.keys(opts.context).filter(key => !key.startsWith('effect/'))])).toEqual([
      ['middleware', []],
      ['middleware', ['first', 'plain']],
      ['handler', ['first', 'plain', 'second']],
    ])
  })

  it('can map own and downstream failures to a different error type via effect/wrap', async () => {
    const middlewareError = new Error('__MIDDLEWARE__')
    const downstreamError = new Error('__DOWNSTREAM__')

    const context: WithEffectContext<never> = {
      'effect/context': Context.empty(),
      'effect/wrap': (effect, opts) => effect.pipe(
        Effect.mapError(error => error instanceof ORPCError
          ? error
          : new ORPCError('BAD_REQUEST', { message: opts.kind, cause: error })),
      ),
    }

    await expect(call(
      os
        .$context<WithEffectContext<never>>()
        .use(middlewareGen(function* () {
          return yield* Effect.fail(middlewareError)
        }))
        .handler(() => 'unreachable'),
      undefined,
      { context },
    )).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause === middlewareError,
    )

    await expect(call(
      os
        .$context<WithEffectContext<never>>()
        .use(middlewareGen(function* ({ next }) {
          return yield* next()
        }))
        .handler(() => {
          throw downstreamError
        }),
      undefined,
      { context },
    )).rejects.toSatisfy(
      error => error instanceof ORPCError && error.message === 'middleware' && error.cause === downstreamError,
    )

    // already mapped by the handler wrap, passes through the middleware wrap as-is
    await expect(call(
      os
        .$context<WithEffectContext<never>>()
        .use(middlewareGen(function* ({ next }) {
          return yield* next()
        }))
        .handler(handlerGen(function* () {
          return yield* Effect.fail(downstreamError)
        })),
      undefined,
      { context },
    )).rejects.toSatisfy(
      error => error instanceof ORPCError && error.message === 'handler' && error.cause === downstreamError,
    )
  })

  it('runs effect/wrap with effect/context so wrap and middleware share services and tracer', async () => {
    const spans: string[] = []
    const tracer = Tracer.make({
      span(options) {
        spans.push(options.name)
        return Tracer.nativeTracer.span(options)
      },
    })

    let serviceInWrap: Option.Option<Service1['Service']> | undefined

    const procedure = os
      .$context<WithEffectContext<Service1>>()
      .use(middlewareGen(function* ({ next }) {
        const service1 = yield* Service1
        return yield* next({ context: { fromService: service1.id } }).pipe(Effect.withSpan('middleware'))
      }))
      .handler(({ context }) => `output:${context.fromService}`)

    await expect(call(procedure, undefined, {
      context: {
        'effect/context': Context.empty().pipe(
          Context.add(Service1, { id: 'Service1' }),
          Context.add(Tracer.Tracer, tracer),
        ),
        'effect/wrap': effect => Effect.gen(function* () {
          serviceInWrap = yield* Effect.serviceOption(Service1)
          return yield* effect
        }).pipe(Effect.withSpan('wrap')),
      },
    })).resolves.toEqual('output:Service1')

    expect(serviceInWrap).toEqual(Option.some({ id: 'Service1' }))
    expect(spans).toEqual(['wrap', 'middleware'])
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
    expect(runPromiseSpy).toHaveBeenNthCalledWith(1, expect.anything(), { context: undefined, signal: controller.signal })
  })
})
