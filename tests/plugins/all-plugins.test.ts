import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { RouterContract } from '@orpc/contract'
import type { WithEffectContext } from '@orpc/experimental-effect'
import type { OpenAPIDocument } from '@orpc/openapi'
import type { Router, RouterClient } from '@orpc/server'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import {
  BatchLinkPlugin,
  DedupeLinkPlugin,
  RequestCompressionLinkPlugin,
  ResponseCompressionLinkPlugin,
  RetryAfterLinkPlugin,
  RetryLinkPlugin,
  TimeoutLinkPlugin,
} from '@orpc/client/plugins'
import { oc } from '@orpc/contract'
import { RequestValidationLinkPlugin, ResponseValidationLinkPlugin } from '@orpc/contract/plugins'
import { EvlogHandlerPlugin } from '@orpc/evlog'
import { createEffectClient, EffectSchemaToJsonSchemaConverter, middlewareGen } from '@orpc/experimental-effect'
import { HibernationHandlerPlugin } from '@orpc/hibernation'
import { SmartCoercionHandlerPlugin, SmartCoercionLinkPlugin } from '@orpc/json-schema'
import { BatchResponseCompressionHandlerPlugin, StaticFileHandlerPlugin, TmpFileUploadHandlerPlugin } from '@orpc/node'
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins'
import { PinoHandlerPlugin } from '@orpc/pino'
import { RateLimitHandlerPlugin } from '@orpc/ratelimit'
import { implement } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import {
  BatchHandlerPlugin,
  CORSHandlerPlugin,
  GetMethodCsrfProtectionHandlerPlugin,
  MethodOverrideHandlerPlugin,
  RequestCompressionHandlerPlugin,
  RequestHeadersHandlerPlugin,
  RequestLimitHandlerPlugin,
  ResponseCompressionHandlerPlugin,
  ResponseHeadersHandlerPlugin,
  RethrowHandlerPlugin,
  TimeoutHandlerPlugin,
} from '@orpc/server/plugins'
import { throwIfAborted } from '@orpc/shared'
import { Context, Effect, Exit, Schema } from 'effect'
import pino from 'pino'
import { z } from 'zod'
import '@orpc/experimental-effect/extensions/effect'
import '@orpc/experimental-effect/extensions/input-output'

/**
 * Every handler and link plugin shipped by the monorepo, mounted on a single handler and a
 * single link, so a plugin that cannot coexist with the others - most often because their
 * `before`/`after` hints resolve into an order that breaks one of them - fails here.
 * The same stack also serves Effect procedures, whose services must survive every plugin's
 * context handling and whose fibers must still be interrupted when the request is aborted.
 *
 * New plugins belong in `createHandlerPlugins` or `createLinkPlugins` below.
 */

interface TestContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext {}

interface TestClientContext extends RetryLinkPluginContext {}

const contract = {
  ping: oc
    .input(z.object({ value: z.number() }))
    .output(z.object({ value: z.number() })),
}

const spec: OpenAPIDocument<'3.2.0'> = {
  openapi: '3.2.0',
  info: { title: 'All Plugins', version: '1.0.0' },
}

const implementer = implement(contract).$context<TestContext>()

const router = implementer.router({
  ping: implementer.ping.handler(({ input }) => input),
})

class Doubler extends Context.Service<
  Doubler,
  {
    readonly double: (value: number) => Effect.Effect<number>
  }
>()('Doubler') {}

interface EffectTestContext extends TestContext, WithEffectContext<Doubler> {}

const effectContract = {
  ping: oc
    .input(Schema.Struct({ value: Schema.Number }))
    .output(Schema.Struct({ value: Schema.Number })),
  sleep: oc
    .input(Schema.Struct({ value: Schema.Number })),
}

const effectImplementer = implement(effectContract).$context<EffectTestContext>()

const acquired = vi.fn<(signal: AbortSignal | undefined) => void>()
const released = vi.fn<(interrupted: boolean) => void>()

const effectRouter = effectImplementer.router({
  ping: effectImplementer.ping
    .use(middlewareGen(function* ({ next }) {
      return yield* next({ context: { offset: 1 } })
    }))
    .effect(function* ({ context }, input) {
      const doubler = yield* Doubler
      const doubled = yield* doubler.double(input.value)
      return { value: doubled + context.offset }
    }),
  sleep: effectImplementer.sleep.effect(function* ({ signal }) {
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => acquired(signal)),
      () => Effect.never,
      (_, exit) => Effect.sync(() => released(Exit.hasInterrupts(exit))),
    )
  }),
})

const effectContext: EffectTestContext = {
  'effect/context': Context.make(Doubler, { double: value => Effect.succeed(value * 2) }),
}

function createHandlerPlugins<T extends TestContext>() {
  return [
    new BatchHandlerPlugin<T>(),
    new BatchResponseCompressionHandlerPlugin<T>({ threshold: 0 }),
    new CORSHandlerPlugin<T>(),
    new EvlogHandlerPlugin<T>(),
    new GetMethodCsrfProtectionHandlerPlugin<T>(),
    new HibernationHandlerPlugin<T>(),
    new MethodOverrideHandlerPlugin(),
    new OpenAPIReferenceHandlerPlugin<T, 'scalar'>({ spec, docsPath: '/docs', specPath: '/spec.json' }),
    new PinoHandlerPlugin<T>({ logger: pino({ level: 'silent' }) }),
    new RateLimitHandlerPlugin<T>(),
    new RequestCompressionHandlerPlugin<T>(),
    new RequestHeadersHandlerPlugin<T>(),
    new RequestLimitHandlerPlugin<T>({ maxBodySize: 10 * 1024 * 1024 }),
    new ResponseCompressionHandlerPlugin<T>({ threshold: 0 }),
    new ResponseHeadersHandlerPlugin<T>(),
    new RethrowHandlerPlugin<T>({ filter: () => false }),
    new SmartCoercionHandlerPlugin({ converters: [new EffectSchemaToJsonSchemaConverter()] }),
    new StaticFileHandlerPlugin<T>({ rootDir: import.meta.dirname, path: '/static' }),
    new TimeoutHandlerPlugin<T>({ timeout: 5000 }),
    new TmpFileUploadHandlerPlugin<T>({
      maxBodySize: {
        memory: 10 * 1024 * 1024,
        file: 10 * 1024 * 1024,
        stream: 10 * 1024 * 1024,
      },
    }),
  ]
}

function createLinkPlugins(contract: RouterContract) {
  return [
    new BatchLinkPlugin<TestClientContext>({ groups: [{ condition: () => true, context: {} }] }),
    new DedupeLinkPlugin<TestClientContext>({ groups: [{ condition: () => true, context: {} }] }),
    new RequestCompressionLinkPlugin<TestClientContext>({ threshold: 0 }),
    new RequestValidationLinkPlugin<TestClientContext>(contract),
    new ResponseCompressionLinkPlugin<TestClientContext>(),
    new ResponseValidationLinkPlugin<TestClientContext>(contract),
    new RetryAfterLinkPlugin<TestClientContext>(),
    new RetryLinkPlugin<TestClientContext>(),
    new SmartCoercionLinkPlugin<TestClientContext>(contract, { converters: [new EffectSchemaToJsonSchemaConverter()] }),
    new TimeoutLinkPlugin<TestClientContext>({ timeout: 5000 }),
  ]
}

function createClientServer<T extends TestContext, TRouter extends Router<T>>(
  options: { router: TRouter, contract: RouterContract, context: T },
) {
  const handler = new RPCHandler<T>(options.router, {
    allowMethods: ['GET', 'POST', 'QUERY'], // batch requests and their sub-requests use any of them
    plugins: createHandlerPlugins<T>(),
  })

  const exchanges: { request: Request, response: Response }[] = []

  const link = new RPCLink<TestClientContext>({
    url: '/rpc',
    origin: 'http://localhost',
    plugins: createLinkPlugins(options.contract),
    async fetch(url, init) {
      const request = new Request(url, init)

      const { response } = await handler.handle(request, {
        context: options.context,
        prefix: '/rpc',
      })

      throwIfAborted(request.signal) // like a real fetch, an aborted request never resolves with a response

      const resolved = response ?? new Response('Not Found', { status: 404 })
      exchanges.push({ request, response: resolved })

      return resolved
    },
  })

  return {
    handler,
    exchanges,
    client: createORPCClient<RouterClient<TRouter, TestClientContext>>(link),
  }
}

describe('all plugins on one handler and one link', () => {
  it('batches concurrent calls through every plugin', async () => {
    const { client, exchanges } = createClientServer({ router, contract, context: {} })

    await expect(Promise.all([
      client.ping({ value: 1 }),
      client.ping({ value: 2 }),
    ])).resolves.toEqual([
      { value: 1 },
      { value: 2 },
    ])

    expect(exchanges).toHaveLength(1) // both calls travelled in a single batch request
    expect(exchanges[0]!.request.headers.get('orpc-batch')).toEqual('streaming')
    // the batch request is compressed as a whole, and decompressed before it is split
    expect(exchanges[0]!.request.headers.get('content-encoding')).toEqual('gzip')
    // the batch response is compressed as a whole, and decompressed before it is decoded
    expect(exchanges[0]!.response.headers.get('content-encoding')).toEqual('gzip')
  })

  it('compresses a standalone call in both directions through every plugin', async () => {
    const { client, exchanges } = createClientServer({ router, contract, context: {} })

    await expect(client.ping({ value: 1 })).resolves.toEqual({ value: 1 })

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.request.headers.get('content-encoding')).toEqual('gzip')
    expect(exchanges[0]!.response.headers.get('content-encoding')).toEqual('gzip')
  })

  it('serves the openapi reference behind the other routing plugins', async () => {
    const { handler } = createClientServer({ router, contract, context: {} })

    const { response } = await handler.handle(new Request('http://localhost/rpc/spec.json'), {
      context: {},
      prefix: '/rpc',
    })

    expect(response?.status).toEqual(200)
    await expect(response?.json()).resolves.toEqual(spec)
  })
})

describe('effect procedures on all plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('batches concurrent effect calls through every plugin', async () => {
    const { client, exchanges } = createClientServer({ router: effectRouter, contract: effectContract, context: effectContext })

    await expect(Promise.all([
      client.ping({ value: 1 }),
      client.ping({ value: 2 }),
    ])).resolves.toEqual([
      { value: 3 },
      { value: 5 },
    ])

    expect(exchanges).toHaveLength(1) // both calls travelled in a single batch request
    expect(exchanges[0]!.request.headers.get('orpc-batch')).toEqual('streaming')
    expect(exchanges[0]!.request.headers.get('content-encoding')).toEqual('gzip')
    expect(exchanges[0]!.response.headers.get('content-encoding')).toEqual('gzip')
  })

  it('runs concurrent createEffectClient calls through every plugin', async () => {
    const { client, exchanges } = createClientServer({ router: effectRouter, contract: effectContract, context: effectContext })
    const effectClient = createEffectClient(client)

    await expect(Effect.runPromise(Effect.all([
      effectClient.ping({ value: 1 }),
      effectClient.ping({ value: 2 }),
    ], { concurrency: 'unbounded' }))).resolves.toEqual([
      { value: 3 },
      { value: 5 },
    ])

    expect(exchanges).toHaveLength(1) // both calls travelled in a single batch request
  })

  it('interrupts the effect handler fiber when the client aborts through every plugin', async () => {
    const { client } = createClientServer({ router: effectRouter, contract: effectContract, context: effectContext })
    const controller = new AbortController()

    const promise = expect(client.sleep({ value: 1 }, { signal: controller.signal })).rejects.toThrowError('abort')

    await vi.waitFor(() => expect(acquired).toHaveBeenCalledTimes(1))
    const signal = acquired.mock.calls[0]![0]!
    expect(signal.aborted).toBe(false)

    controller.abort()
    await promise

    await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1))
    expect(released).toHaveBeenCalledWith(true)
    expect(signal.aborted).toBe(true)
  })
})
