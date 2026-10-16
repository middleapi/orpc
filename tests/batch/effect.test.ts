import type { WithEffectContext } from '@orpc/experimental-effect'
import { isDefinedError } from '@orpc/client'
import { createEffectClient, middlewareGen } from '@orpc/experimental-effect'
import { os } from '@orpc/server'
import { promiseWithResolvers } from '@orpc/shared'
import { Context, Effect, Schema } from 'effect'
import { createCompressionHonoFetchBatchClientServerTest } from './__shared__/client-server.compression-hono-fetch'
import { createCompressionNodeHttpBatchClientServerTest } from './__shared__/client-server.compression-node-http'
import { createHonoFetchBatchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpBatchClientServerTest } from './__shared__/client-server.node-http'
import '@orpc/experimental-effect/extensions/effect'
import '@orpc/experimental-effect/extensions/input-output'

class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: (name: string) => Effect.Effect<string>
  }
>()('Greeter') {}

const effectContext = Context.make(Greeter, {
  greet: name => Effect.succeed(`Hello ${name}`),
})

const base = os.$context<WithEffectContext<Greeter>>()

describe.each([
  ['node-http', createNodeHttpBatchClientServerTest],
  ['hono-fetch', createHonoFetchBatchClientServerTest],
  ['compression-node-http', createCompressionNodeHttpBatchClientServerTest],
  ['compression-hono-fetch', createCompressionHonoFetchBatchClientServerTest],
])('effect procedures in batch: %s', (_name, createClientServer) => {
  const router = {
    greet: base
      .use(middlewareGen(function* ({ next }) {
        return yield* next({ context: { punctuation: '!' } })
      }))
      .input(Schema.Struct({ name: Schema.String }))
      .output(Schema.Struct({ greeting: Schema.String }))
      .effect(function* ({ context }, input) {
        const greeter = yield* Greeter
        const greeting = yield* greeter.greet(input.name)
        return { greeting: `${greeting}${context.punctuation}` }
      }),
    reject: base
      .errors({ FORBIDDEN: { message: 'Not allowed' } })
      .input(Schema.String)
      .effect(function* ({ errors }, input) {
        return yield* Effect.fail(errors.FORBIDDEN({ message: `Not allowed: ${input}` }))
      }),
  }

  it('keeps successful and failed effect subrequests isolated within one batch', async () => {
    const { client, fetchSpy } = createClientServer(router, { context: { 'effect/context': effectContext } })

    const [success, failure] = await Promise.allSettled([
      client.greet({ name: 'alpha' }),
      client.reject('beta'),
    ])

    expect(success).toEqual({ status: 'fulfilled', value: { greeting: 'Hello alpha!' } })
    expect(failure).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'FORBIDDEN', message: 'Not allowed: beta', defined: true }),
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  it('batches concurrent createEffectClient calls run with Effect.all', async () => {
    const { client, fetchSpy } = createClientServer(router, { context: { 'effect/context': effectContext } })
    const effectClient = createEffectClient(client)

    const program = Effect.all([
      effectClient.greet({ name: 'alpha' }),
      effectClient.greet({ name: 'beta' }),
      effectClient.reject('gamma').pipe(
        Effect.catchIf(isDefinedError, error => Effect.succeed({ greeting: error.message })),
      ),
    ], { concurrency: 'unbounded' })

    await expect(Effect.runPromise(program)).resolves.toEqual([
      { greeting: 'Hello alpha!' },
      { greeting: 'Hello beta!' },
      { greeting: 'Not allowed: gamma' },
    ])
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })

  it.each(['streaming', 'buffered'] as const)('streams AsyncIteratorObject outputs returned by effects in %s mode', async (mode) => {
    const release = promiseWithResolvers<void>()

    const streamRouter = {
      ...router,
      events: base.effect(function* () {
        const greeter = yield* Greeter
        const first = yield* greeter.greet('first')

        return (async function* () {
          yield first
          await release.promise
          return 'done'
        }())
      }),
    }

    const { client, fetchSpy } = createClientServer(streamRouter, { context: { 'effect/context': effectContext }, mode })

    // The stream holds everything after its first event until the test releases it, so a batch
    // that waited for every subresponse to finish would hang here instead of resolving.
    const [iterator, greeted] = await Promise.all([
      client.events(),
      client.greet({ name: 'alpha' }),
    ])

    expect(greeted).toEqual({ greeting: 'Hello alpha!' })
    await expect(iterator.next()).resolves.toEqual({ value: 'Hello first', done: false })

    release.resolve()
    await expect(iterator.next()).resolves.toEqual({ value: 'done', done: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ensure batch was used
  })
})
