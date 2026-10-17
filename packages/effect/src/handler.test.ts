import type { EffectWrapOptions, WithEffectContext } from './context'
import { call, ORPCError, os, type } from '@orpc/server'
import { Cause, Context, Effect, Option, Tracer } from 'effect'
import { z } from 'zod'
import { handlerGen } from './handler'
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
    readonly id: 'Service2'
  }
>()('Service2') {}

describe('handlerGen', () => {
  it('works with native Effect syntax, and throws failed ORPCError as-is', async () => {
    await expect(
      call(os.handler(handlerGen(function* () {
        return 'output'
      }))),
    ).resolves.toEqual('output')

    const error = new ORPCError('__TEST__')

    await expect(
      call(os.handler(handlerGen(function* () {
        yield* Effect.fail(error)
      }))),
    ).rejects.toBe(error)
    expect(error.defined).toBe(false)
  })

  it('throw original errors without fiber failure error wrapper', async () => {
    const error = new Error('__TEST__')
    await expect(
      call(os.handler(handlerGen(function* () {
        yield* Effect.fail(error)
      }))),
    ).rejects.toBe(error)

    expect(runPromiseSpy).toHaveBeenCalledTimes(1)
  })

  it('forwards the provided signal to runPromise', async () => {
    const controller = new AbortController()

    await expect(
      call(
        os.handler(handlerGen(function* () {
          return 'output'
        })),
        undefined,
        { signal: controller.signal },
      ),
    ).resolves.toEqual('output')

    expect(runPromiseSpy).toHaveBeenCalledTimes(1)
    expect(runPromiseSpy).toHaveBeenNthCalledWith(1, expect.anything(), { context: undefined, signal: controller.signal })
  })

  it('can access context, input, errors, signal, ...', async () => {
    const procedure = os.input(type<any>()).handler(handlerGen(function* ({ context, signal, lastEventId, path }, input) {
      expect(input).toEqual('input')
      expect(context).toEqual({ context: true })
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(lastEventId).toEqual('id')
      expect(path).toEqual(['path'])

      return 'success'
    }))

    await expect(
      call(
        procedure,
        'input',
        { context: { context: true }, signal: AbortSignal.timeout(0), lastEventId: 'id', path: ['path'] },
      ),
    ).resolves.toEqual('success')
  })

  it('can deal with effect context', async () => {
    await expect(call(
      os
        .$context<WithEffectContext<Service1>>()
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          return `output:${service1.id}`
        })),
      undefined,
      { context: { 'effect/context': Context.empty().pipe(Context.add(Service1, { id: 'Service1' })) } },
    )).resolves.toEqual('output:Service1')

    await expect(call(
      os
        .$context<any>()
        .handler(handlerGen(function* () {
          const service1 = yield* Service1
          const service2 = yield* Service2
          return `output:${service1.id}`
        })),
      undefined,
      { context: { 'effect/context': Context.empty().pipe(Context.add(Service1, { id: 'Service1' })) } },
    )).rejects.toThrow('Service2')
  })

  it('can wrap effect execution and receives handler options', async () => {
    const wrap = vi.fn((effect: any, _opts: EffectWrapOptions) => effect)

    const procedure = os
      .$context<WithEffectContext<never>>()
      .input(z.object({ id: z.string().transform(Number) }))
      .errors({ BASE: {} })
      .handler(handlerGen(function* () {
        return 'output'
      }))

    const signal = AbortSignal.timeout(100)
    const context = { 'effect/context': Context.empty(), 'effect/wrap': wrap }

    await expect(call(
      procedure,
      { id: '1' },
      { path: ['wrapped', 'procedure'], context, signal, lastEventId: 'id' },
    )).resolves.toEqual('output')

    expect(wrap).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      kind: 'handler',
      context,
      input: { id: 1 },
      path: ['wrapped', 'procedure'],
      procedure,
      signal,
      lastEventId: 'id',
      errors: { BASE: expect.any(Function) },
    })
  })

  it('can map failures to a different error type via wrap', async () => {
    const domainError = new Error('__DOMAIN__')

    const procedure = os
      .$context<WithEffectContext<never>>()
      .handler(handlerGen(function* () {
        return yield* Effect.fail(domainError)
      }))

    await expect(call(procedure, undefined, {
      context: {
        'effect/context': Context.empty(),
        'effect/wrap': effect => effect.pipe(
          Effect.mapError(error => new ORPCError('BAD_REQUEST', { cause: error })),
        ),
      },
    })).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause === domainError,
    )
  })

  it('can convert defects to ORPCError via wrap with catchCause', async () => {
    const defect = new Error('__DEFECT__')

    const procedure = os
      .$context<WithEffectContext<never>>()
      .handler(handlerGen(function* () {
        throw defect
      }))

    await expect(call(procedure, undefined, {
      context: {
        'effect/context': Context.empty(),
        'effect/wrap': effect => effect.pipe(
          Effect.catchCause(cause => Effect.fail(new ORPCError('INTERNAL_SERVER_ERROR', { cause: Cause.squash(cause) }))),
        ),
      },
    })).rejects.toSatisfy(
      error => error instanceof ORPCError && error.code === 'INTERNAL_SERVER_ERROR' && error.cause === defect,
    )
  })

  it('runs wrap with effect/context so wrap and handler share services and tracer', async () => {
    const spans: Tracer.Span[] = []
    const tracer = Tracer.make({
      span(options) {
        const span = Tracer.nativeTracer.span(options)
        spans.push(span)
        return span
      },
    })

    let serviceInWrap: Option.Option<Service1['Service']> | undefined

    const procedure = os
      .$context<WithEffectContext<Service1>>()
      .handler(handlerGen(function* () {
        const service1 = yield* Service1
        return yield* Effect.succeed(`output:${service1.id}`).pipe(Effect.withSpan('handler'))
      }))

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
    expect(spans.map(span => span.name)).toEqual(['wrap', 'handler'])
    expect(spans[1]!.parent).toEqual(Option.some(spans[0]))
  })

  it('lets services provided by wrap take precedence over effect/context', async () => {
    const procedure = os
      .$context<WithEffectContext<Service1>>()
      .handler(handlerGen(function* () {
        const service1 = yield* Service1
        return `output:${service1.id}`
      }))

    await expect(call(procedure, undefined, {
      context: {
        'effect/context': Context.empty().pipe(Context.add(Service1, { id: 'Service1' })),
        'effect/wrap': effect => effect.pipe(Effect.provideService(Service1, { id: 'fromWrap' as any })),
      },
    })).resolves.toEqual('output:fromWrap')
  })

  it('throws ORPCError failures from wrap as-is', async () => {
    const error = new ORPCError('__TEST__')

    const procedure = os
      .$context<WithEffectContext<never>>()
      .handler(handlerGen(function* () {
        return 'output'
      }))

    await expect(call(
      procedure,
      undefined,
      {
        context: {
          'effect/context': Context.empty(),
          'effect/wrap': () => Effect.fail(error),
        },
      },
    )).rejects.toBe(error)
    expect(error.defined).toBe(false)
  })
})
