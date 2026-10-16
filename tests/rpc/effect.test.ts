import type { WithEffectContext } from '@orpc/experimental-effect'
import { isDefinedError, ORPCError } from '@orpc/client'
import { catchORPCErrorCode, createEffectClient, middlewareGen } from '@orpc/experimental-effect'
import { os } from '@orpc/server'
import { promiseWithResolvers } from '@orpc/shared'
import { Context, Data, Effect, Exit, Fiber, Schema } from 'effect'
import { builtInRPCSupportDataTypes } from './__shared__/built-in-support-data-types'
import { Person } from './__shared__/client-server'
import { createCompressionCrosswsClientServerTest } from './__shared__/client-server.compression-crossws'
import { createCompressionHonoFetchClientServerTest } from './__shared__/client-server.compression-hono-fetch'
import { createCompressionMessagePortClientServerTest } from './__shared__/client-server.compression-message-port'
import { createCompressionMessagePortTransferClientServerTest } from './__shared__/client-server.compression-message-port-transfer'
import { createCompressionNodeHttpClientServerTest } from './__shared__/client-server.compression-node-http'
import { createCompressionNodeWsClientServerTest } from './__shared__/client-server.compression-node-ws'
import { createCrosswsClientServerTest } from './__shared__/client-server.crossws'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createMessagePortClientServerTest } from './__shared__/client-server.message-port'
import { createMessagePortTransferClientServerTest } from './__shared__/client-server.message-port-transfer'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'
import { createNodeWsClientServerTest } from './__shared__/client-server.node-ws'
import '@orpc/experimental-effect/extensions/effect'
import '@orpc/experimental-effect/extensions/input-output'

class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: (name: string) => Effect.Effect<string>
  }
>()('Greeter') {}

class Boom extends Data.TaggedError('Boom')<{ readonly reason: string }> {}

const effectContext = Context.make(Greeter, {
  greet: name => Effect.succeed(`Hello ${name}`),
})

const base = os.$context<WithEffectContext<Greeter>>()

const requireAuth = base
  .errors({ UNAUTHORIZED: { message: 'Sign in first' } })
  .middleware(middlewareGen(function* ({ errors, next }) {
    yield* Effect.fail(errors.UNAUTHORIZED())
    return yield* next()
  }))

describe.each([
  ['crossws', createCrosswsClientServerTest],
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
  ['message-port', createMessagePortClientServerTest],
  ['message-port-transfer', createMessagePortTransferClientServerTest],
  ['node-ws', createNodeWsClientServerTest],
  ['compression-crossws', createCompressionCrosswsClientServerTest],
  ['compression-hono-fetch', createCompressionHonoFetchClientServerTest],
  ['compression-message-port-transfer', createCompressionMessagePortTransferClientServerTest],
  ['compression-message-port', createCompressionMessagePortClientServerTest],
  ['compression-node-http', createCompressionNodeHttpClientServerTest],
  ['compression-node-ws', createCompressionNodeWsClientServerTest],
] as const)('effect procedures: %s', (_name, createClientServer) => {
  const acquired = vi.fn<(signal: AbortSignal | undefined) => void>()
  const released = vi.fn<(interrupted: boolean) => void>()
  const flakyAttempt = vi.fn()
  const guardedHandler = vi.fn()
  let releaseEvents = promiseWithResolvers<void>()

  beforeEach(() => {
    vi.clearAllMocks()
    releaseEvents = promiseWithResolvers<void>()
  })

  const router = {
    echo: base
      .input(Schema.Unknown)
      .output(Schema.Unknown)
      .effect(function* (_, input) {
        return input
      }),
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
    lastEventId: base.effect(function* ({ lastEventId }) {
      return lastEventId
    }),
    events: base.effect(function* () {
      const greeter = yield* Greeter
      const first = yield* greeter.greet('first')

      return (async function* () {
        yield first
        await releaseEvents.promise
        yield { second: new Date('2024-01-01') }
        return new Person('done', 3)
      }())
    }),
    sleep: base.effect(function* ({ signal }) {
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => acquired(signal)),
        () => Effect.never,
        (_, exit) => Effect.sync(() => released(Exit.hasInterrupts(exit))),
      )
    }),
    find: base
      .errors({
        NOT_FOUND: {
          data: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
        },
      })
      .input(Schema.Struct({ id: Schema.String }))
      .effect(function* ({ errors }, input) {
        if (input.id !== 'earth') {
          return yield* Effect.fail(errors.NOT_FOUND({ message: `Planet ${input.id} not found`, data: { id: input.id } }))
        }

        return { id: input.id }
      }),
    conflict: base.effect(function* () {
      return yield* Effect.fail(new ORPCError('CONFLICT', { message: 'Already exists', data: { at: 'conflict' } }))
    }),
    boom: base.effect(function* () {
      return yield* new Boom({ reason: 'secret' })
    }),
    guarded: base
      .use(requireAuth)
      .effect(function* () {
        guardedHandler()
        return 'unreachable'
      }),
    flaky: base
      .errors({ UNAVAILABLE: {} })
      .effect(function* ({ errors }) {
        flakyAttempt()

        if (flakyAttempt.mock.calls.length < 3) {
          return yield* Effect.fail(errors.UNAVAILABLE())
        }

        return `recovered after ${flakyAttempt.mock.calls.length} attempts`
      }),
  }

  const client = createClientServer(router, {
    context: { 'effect/context': effectContext },
  })

  const effectClient = createEffectClient(client)

  describe('data transfer', () => {
    it.each(builtInRPCSupportDataTypes)('should support $name', async ({ value, expected }) => {
      await expect(client.echo(value)).resolves.toEqual(expected)
    })

    it('supports transferring nested File and Blob values', async () => {
      const value = {
        file: new File(['file content'], 'test.txt', { type: 'text/plain' }),
        nested: {
          blob: new Blob(['blob content'], { type: 'text/plain' }),
        },
      }

      const output = await client.echo(value) as typeof value

      expect(output.file).toBeInstanceOf(File)
      expect(output.file.name).toBe(value.file.name)
      expect(await output.file.text()).toBe('file content')
      expect(output.nested.blob).toBeInstanceOf(Blob)
      expect(await output.nested.blob.text()).toBe('blob content')
    })

    it('supports custom serializer', async () => {
      const person = new Person('Alice', 30)

      await expect(client.echo(person)).resolves.toEqual(person)
    })

    it('validates effect schemas, runs effectful middleware, and provides effect/context services', async () => {
      await expect(client.greet({ name: 'Alice' })).resolves.toEqual({ greeting: 'Hello Alice!' })
    })

    it('supports lastEventId', async () => {
      await expect(client.lastEventId(undefined, { lastEventId: '__EVENT_ID__' })).resolves.toEqual('__EVENT_ID__')
    })

    it('streams AsyncIteratorObject outputs returned by effects', async () => {
      // The source holds everything after its first event until the test releases it, so a transport
      // that buffered the stream would hang here instead of resolving.
      const iterator = await client.events()

      await expect(iterator.next()).resolves.toEqual({ value: 'Hello first', done: false })

      releaseEvents.resolve()
      await expect(iterator.next()).resolves.toEqual({ value: { second: new Date('2024-01-01') }, done: false })
      await expect(iterator.next()).resolves.toEqual({ value: new Person('done', 3), done: true })
    })
  })

  describe('cancel and abort', () => {
    it('interrupts the handler fiber and runs its finalizers when the client aborts', async () => {
      const controller = new AbortController()

      const promise = expect(client.sleep(undefined, { signal: controller.signal })).rejects.toThrowError('abort')

      await vi.waitFor(() => expect(acquired).toHaveBeenCalledTimes(1))
      const signal = acquired.mock.calls[0]![0]!
      expect(signal.aborted).toBe(false)
      expect(released).not.toHaveBeenCalled()

      controller.abort()
      await promise

      await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1))
      expect(released).toHaveBeenCalledWith(true)
      expect(signal.aborted).toBe(true)
    })
  })

  describe('errors', () => {
    it('delivers `yield* Effect.fail(errors.X())` as a defined error', async () => {
      const error = await client.find({ id: 'pluto' }).catch(e => e)

      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Planet pluto not found',
        data: { id: 'pluto' },
        defined: true,
      })
    })

    it('delivers defined errors failed by effectful middleware without running the handler', async () => {
      await expect(client.guarded()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Sign in first',
        defined: true,
      })

      expect(guardedHandler).not.toHaveBeenCalled()
    })

    it('delivers undeclared ORPCError failures as-is with defined=false', async () => {
      await expect(client.conflict()).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Already exists',
        data: { at: 'conflict' },
        defined: false,
      })
    })

    it('hides non-ORPCError failures behind INTERNAL_SERVER_ERROR', async () => {
      const error = await client.boom().catch(e => e)

      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', defined: false })
      expect(error.message).not.toContain('secret')
    })

    it('rejects input that fails effect schema validation with BAD_REQUEST', async () => {
      await expect(client.greet({ name: 123 } as any)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Input validation failed',
        data: {
          issues: expect.arrayContaining([
            expect.objectContaining({ path: ['name'] }),
          ]),
        },
      })
    })
  })

  describe('createEffectClient', () => {
    it('yields outputs inside Effect generators', async () => {
      const program = Effect.gen(function* () {
        const { greeting } = yield* effectClient.greet({ name: 'Bob' })
        const found = yield* effectClient.find({ id: 'earth' })
        return `${greeting} from ${found.id}`
      })

      await expect(Effect.runPromise(program)).resolves.toBe('Hello Bob! from earth')
    })

    it('lands defined errors in the error channel', async () => {
      const recovered = effectClient.find({ id: 'pluto' }).pipe(
        catchORPCErrorCode('NOT_FOUND', error => Effect.succeed(error.data)),
      )

      await expect(Effect.runPromise(recovered)).resolves.toEqual({ id: 'pluto' })

      const typed = effectClient.find({ id: 'mars' }).pipe(
        Effect.catchIf(isDefinedError, error => Effect.succeed(`${error.code}:${error.data.id}`)),
      )

      await expect(Effect.runPromise(typed)).resolves.toBe('NOT_FOUND:mars')
    })

    it('aborts the server handler signal and interrupts its fiber when the effect is interrupted', async () => {
      const fiber = Effect.runFork(effectClient.sleep())

      await vi.waitFor(() => expect(acquired).toHaveBeenCalledTimes(1))
      const signal = acquired.mock.calls[0]![0]!
      expect(signal.aborted).toBe(false)

      await Effect.runPromise(Fiber.interrupt(fiber))
      const exit = await Effect.runPromise(Fiber.await(fiber))
      expect(Exit.hasInterrupts(exit)).toBe(true)

      await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1))
      expect(released).toHaveBeenCalledWith(true)
      expect(signal.aborted).toBe(true)
    })

    it('re-sends the request on Effect.retry', async () => {
      const program = effectClient.flaky().pipe(
        Effect.retry({
          times: 5,
          while: error => isDefinedError(error) && error.code === 'UNAVAILABLE',
        }),
      )

      await expect(Effect.runPromise(program)).resolves.toBe('recovered after 3 attempts')
      expect(flakyAttempt).toHaveBeenCalledTimes(3)
    })

    it('keeps streaming event iterator outputs after the effect completes', async () => {
      const [first, iterator] = await Effect.runPromise(Effect.gen(function* () {
        const iterator = yield* effectClient.events()
        const first = yield* Effect.promise(() => iterator.next())
        return [first, iterator] as const
      }))

      expect(first).toEqual({ value: 'Hello first', done: false })

      releaseEvents.resolve()
      await expect(iterator.next()).resolves.toEqual({ value: { second: new Date('2024-01-01') }, done: false })
      await expect(iterator.next()).resolves.toEqual({ value: new Person('done', 3), done: true })
    })
  })
})
