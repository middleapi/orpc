import type { WithEffectContext } from '@orpc/experimental-effect'
import { handlerGen, middlewareGen } from '@orpc/experimental-effect'
import { createProcedureClient, os, type } from '@orpc/server'
import { Context, Effect } from 'effect'
import { bench } from 'vitest'
import '@orpc/experimental-effect/extensions/effect'

/**
 * Mirrors `procedure-call.bench.ts` with Effect at each layer: every effectful handler and
 * middleware runs its own fiber, so comparing a case here with its promise-based counterpart
 * there shows the per-layer cost of `.effect`, `handlerGen` and `middlewareGen`.
 */

class Clock extends Context.Service<
  Clock,
  {
    readonly now: Effect.Effect<number>
  }
>()('Clock') {}

const context = {
  'effect/context': Context.make(Clock, { now: Effect.succeed(0) }),
}

const base = os.$context<WithEffectContext<Clock>>()

const auth = base.middleware(middlewareGen(function* ({ next }) {
  return yield* next({ context: { userId: 'user-1' } })
}))

const log = base.middleware(middlewareGen(function* ({ next }) {
  return yield* next()
}))

const timing = base.middleware(middlewareGen(function* ({ next }) {
  const clock = yield* Clock
  const startedAt = yield* clock.now
  return yield* next({ context: { startedAt } })
}))

const effect = os.effect(function* (_, input) {
  return input
})

const services = base.handler(handlerGen(function* (_, input) {
  const clock = yield* Clock
  yield* clock.now
  return input
}))

const middlewares = base
  .use(auth)
  .use(log)
  .use(timing)
  .handler(({ input }) => input)

const full = base
  .use(auth)
  .use(log)
  .use(timing)
  .input(type<any>())
  .output(type<any>())
  .effect(function* (_, input) {
    return input
  })

const effectClient = createProcedureClient(effect)
const servicesClient = createProcedureClient(services, { context })
const middlewaresClient = createProcedureClient(middlewares, { context })
const fullClient = createProcedureClient(full, {
  context,
  interceptors: [({ next }) => next()],
})

describe('effect procedure call', () => {
  const input = {
    id: 1,
    name: `1tem-${1}`,
    active: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    largeInt: 9007199254740993n + BigInt(1),
  }

  bench('.effect handler', async () => {
    await effectClient(input as any)
  })

  bench('handlerGen with effect/context services', async () => {
    await servicesClient(input as any)
  })

  bench('middlewareGen x3', async () => {
    await middlewaresClient(input as any)
  })

  bench('full (middlewareGen x3 + validated + interceptors + .effect handler)', async () => {
    await fullClient(input)
  })
})
