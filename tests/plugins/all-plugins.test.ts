import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { OpenAPIDocument } from '@orpc/openapi'
import type { OpenRPCClient, OpenRPCDocument } from '@orpc/openrpc'
import type { RouterClient } from '@orpc/server'
import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { createORPCClient, ORPCError } from '@orpc/client'
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
import { HibernationHandlerPlugin } from '@orpc/hibernation'
import { SmartCoercionHandlerPlugin, SmartCoercionLinkPlugin } from '@orpc/json-schema'
import { BatchResponseCompressionHandlerPlugin, StaticFileHandlerPlugin, TmpFileUploadHandlerPlugin } from '@orpc/node'
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins'
import { OpenRPCHandler, OpenRPCLink } from '@orpc/openrpc/fetch'
import { OpenRPCDiscoveryHandlerPlugin } from '@orpc/openrpc/plugins'
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
  SignalSyncHandlerPlugin,
  TimeoutHandlerPlugin,
} from '@orpc/server/plugins'
import pino from 'pino'
import { z } from 'zod'

/**
 * Every handler and link plugin shipped by the monorepo, mounted on a single handler and a
 * single link, so a plugin that cannot coexist with the others - most often because their
 * `before`/`after` hints resolve into an order that breaks one of them - fails here.
 *
 * New plugins belong in `createHandlerPlugins` or `createLinkPlugins` below.
 */

interface TestContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext {}

interface TestClientContext extends RetryLinkPluginContext {}

const contract = {
  ping: oc
    .input(z.object({ value: z.number() }))
    .output(z.object({ value: z.number() })),
  login: oc
    .input(z.object({ user: z.string() }))
    .output(z.object({ user: z.string() })),
}

const spec: OpenAPIDocument<'3.2.0'> = {
  openapi: '3.2.0',
  info: { title: 'All Plugins', version: '1.0.0' },
}

const implementer = implement(contract).$context<TestContext>()

const router = implementer.router({
  ping: implementer.ping.handler(({ input }) => input),
  login: implementer.login.handler(({ input, context }) => {
    context.resHeaders?.append('set-cookie', `session=${input.user}; HttpOnly`)
    context.resHeaders?.set('cache-control', 'no-store')
    return input
  }),
})

function createHandlerPlugins() {
  return [
    new BatchHandlerPlugin<TestContext>(),
    new BatchResponseCompressionHandlerPlugin<TestContext>({ threshold: 0 }),
    new CORSHandlerPlugin<TestContext>(),
    new EvlogHandlerPlugin<TestContext>(),
    new GetMethodCsrfProtectionHandlerPlugin<TestContext>(),
    new HibernationHandlerPlugin<TestContext>(),
    new MethodOverrideHandlerPlugin(),
    new OpenAPIReferenceHandlerPlugin<TestContext, 'scalar'>({ spec, docsPath: '/docs', specPath: '/spec.json' }),
    new PinoHandlerPlugin<TestContext>({ logger: pino({ level: 'silent' }) }),
    new RateLimitHandlerPlugin<TestContext>(),
    new RequestCompressionHandlerPlugin<TestContext>(),
    new RequestHeadersHandlerPlugin<TestContext>(),
    new RequestLimitHandlerPlugin<TestContext>({ maxBodySize: 10 * 1024 * 1024 }),
    new ResponseCompressionHandlerPlugin<TestContext>({ threshold: 0 }),
    new ResponseHeadersHandlerPlugin<TestContext>(),
    new RethrowHandlerPlugin<TestContext>({ filter: () => false }),
    new SignalSyncHandlerPlugin<TestContext>(),
    new SmartCoercionHandlerPlugin(),
    new StaticFileHandlerPlugin<TestContext>({ rootDir: import.meta.dirname, path: '/static' }),
    new TimeoutHandlerPlugin<TestContext>({ timeout: 5000 }),
    new TmpFileUploadHandlerPlugin<TestContext>({
      maxBodySize: {
        memory: 10 * 1024 * 1024,
        file: 10 * 1024 * 1024,
        stream: 10 * 1024 * 1024,
      },
    }),
  ]
}

function createLinkPlugins() {
  return [
    new BatchLinkPlugin<TestClientContext>({ groups: [{ condition: () => true, context: {} }] }),
    new DedupeLinkPlugin<TestClientContext>({ groups: [{ condition: () => true, context: {} }] }),
    new RequestCompressionLinkPlugin<TestClientContext>({ threshold: 0 }),
    new RequestValidationLinkPlugin<TestClientContext>(contract),
    new ResponseCompressionLinkPlugin<TestClientContext>(),
    new ResponseValidationLinkPlugin<TestClientContext>(contract),
    new RetryAfterLinkPlugin<TestClientContext>(),
    new RetryLinkPlugin<TestClientContext>(),
    new SmartCoercionLinkPlugin<TestClientContext>(contract),
    new TimeoutLinkPlugin<TestClientContext>({ timeout: 5000 }),
  ]
}

function createClientServer() {
  const handler = new RPCHandler(router, {
    allowMethods: ['GET', 'POST', 'QUERY'], // batch requests and their sub-requests use any of them
    plugins: createHandlerPlugins(),
  })

  const exchanges: { request: Request, response: Response }[] = []

  const link = new RPCLink<TestClientContext>({
    url: '/rpc',
    origin: 'http://localhost',
    plugins: createLinkPlugins(),
    async fetch(url, init) {
      const request = new Request(url, init)

      const { response } = await handler.handle(request, {
        context: {},
        prefix: '/rpc',
      })

      const resolved = response ?? new Response('Not Found', { status: 404 })
      exchanges.push({ request, response: resolved })

      return resolved
    },
  })

  return {
    handler,
    exchanges,
    client: createORPCClient<RouterClient<typeof router, TestClientContext>>(link),
  }
}

describe('all plugins on one handler and one link', () => {
  it('batches concurrent calls through every plugin', async () => {
    const { client, exchanges } = createClientServer()

    await expect(Promise.all([
      client.ping({ value: 1 }),
      client.ping({ value: 2 }),
    ])).resolves.toEqual([
      { value: 1 },
      { value: 2 },
    ])

    expect(exchanges).toHaveLength(1) // both calls travelled in a single batch request
    expect(exchanges[0]!.request.headers.get('orpc-batch')).toEqual('1')
    // the batch request is compressed as a whole, and decompressed before it is split
    expect(exchanges[0]!.request.headers.get('content-encoding')).toEqual('gzip')
    // the batch response is compressed as a whole, and decompressed before it is decoded
    expect(exchanges[0]!.response.headers.get('content-encoding')).toEqual('gzip')
  })

  it('sets the cookies and shared headers of batched calls on the batch response', async () => {
    const { client, exchanges } = createClientServer()

    await expect(Promise.all([
      client.login({ user: 'alice' }),
      client.login({ user: 'bob' }),
    ])).resolves.toEqual([
      { user: 'alice' },
      { user: 'bob' },
    ])

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.response.headers.getSetCookie().sort()).toEqual([
      'session=alice; HttpOnly',
      'session=bob; HttpOnly',
    ])
    expect(exchanges[0]!.response.headers.get('cache-control')).toEqual('no-store')
  })

  it('compresses a standalone call in both directions through every plugin', async () => {
    const { client, exchanges } = createClientServer()

    await expect(client.ping({ value: 1 })).resolves.toEqual({ value: 1 })

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.request.headers.get('content-encoding')).toEqual('gzip')
    expect(exchanges[0]!.response.headers.get('content-encoding')).toEqual('gzip')
  })

  it('serves the openapi reference behind the other routing plugins', async () => {
    const { handler } = createClientServer()

    const { response } = await handler.handle(new Request('http://localhost/rpc/spec.json'), {
      context: {},
      prefix: '/rpc',
    })

    expect(response?.status).toEqual(200)
    await expect(response?.json()).resolves.toEqual(spec)
  })
})

describe('all plugins on one OpenRPC handler and one OpenRPC link', () => {
  const openRPCSpec: OpenRPCDocument = {
    openrpc: '1.3.2',
    info: { title: 'All Plugins', version: '1.0.0' },
    methods: [],
  }

  const openRPCRouter = implementer.router({
    ping: implementer.ping.handler(({ input }) => {
      if (input.value < 0) {
        throw new ORPCError('CONFLICT', { message: 'Negative value', data: { value: input.value } })
      }

      return input
    }),
    login: implementer.login.handler(({ input, context }) => {
      context.resHeaders?.append('set-cookie', `session=${input.user}; HttpOnly`)
      context.resHeaders?.set('cache-control', 'no-store')
      return input
    }),
  })

  /**
   * JSON-RPC batches natively, and its requests are always POST.
   */
  function createOpenRPCHandlerPlugins() {
    return [
      ...createHandlerPlugins().filter(plugin => !(
        plugin instanceof BatchHandlerPlugin
        || plugin instanceof MethodOverrideHandlerPlugin
        || plugin instanceof GetMethodCsrfProtectionHandlerPlugin
      )),
      new OpenRPCDiscoveryHandlerPlugin<TestContext>({ spec: openRPCSpec }),
    ]
  }

  function createOpenRPCLinkPlugins() {
    return createLinkPlugins().filter(plugin => !(plugin instanceof BatchLinkPlugin))
  }

  /**
   * Reads a JSON body, decompressing it first when needed.
   */
  async function readJson(message: Request | Response): Promise<unknown> {
    const body = message.headers.get('content-encoding') === 'gzip'
      ? message.body!.pipeThrough(new DecompressionStream('gzip'))
      : message.body

    return new Response(body).json()
  }

  function createClientServer() {
    const handler = new OpenRPCHandler(openRPCRouter, {
      plugins: createOpenRPCHandlerPlugins(),
    })

    const exchanges: { request: Request, response: Response }[] = []

    const link = new OpenRPCLink<TestClientContext>({
      url: '/rpc',
      origin: 'http://localhost',
      plugins: createOpenRPCLinkPlugins(),
      async fetch(url, init) {
        const request = new Request(url, init)
        const requestCopy = request.clone()

        const { response } = await handler.handle(request, {
          context: {},
          prefix: '/rpc',
        })

        const resolved = response ?? new Response('Not Found', { status: 404 })
        exchanges.push({ request: requestCopy, response: resolved.clone() })

        return resolved
      },
    })

    return {
      handler,
      exchanges,
      client: createORPCClient<OpenRPCClient<RouterClient<typeof openRPCRouter, TestClientContext>>>(link),
    }
  }

  it('sorts every compatible plugin', () => {
    expect(() => new OpenRPCHandler(openRPCRouter, { plugins: createOpenRPCHandlerPlugins() })).not.toThrow()
    expect(() => new OpenRPCLink<TestClientContext>({ plugins: createOpenRPCLinkPlugins() })).not.toThrow()
  })

  it('compresses a call in both directions through every plugin', async () => {
    const { client, exchanges } = createClientServer()

    await expect(client.ping({ value: 1 })).resolves.toEqual({ value: 1 })

    expect(exchanges).toHaveLength(1)
    const { request, response } = exchanges[0]!

    expect(request.headers.get('content-encoding')).toEqual('gzip')
    await expect(readJson(request)).resolves.toEqual({ jsonrpc: '2.0', method: 'ping', params: { value: 1 }, id: expect.any(Number) })

    expect(response.status).toEqual(200)
    expect(response.headers.get('content-encoding')).toEqual('gzip')
    await expect(readJson(response)).resolves.toEqual({ jsonrpc: '2.0', id: expect.any(Number), result: { value: 1 } })
  })

  it('sends concurrent calls as separate requests', async () => {
    const { client, exchanges } = createClientServer()

    await expect(Promise.all([
      client.ping({ value: 1 }),
      client.ping({ value: 2 }),
    ])).resolves.toEqual([
      { value: 1 },
      { value: 2 },
    ])

    expect(exchanges).toHaveLength(2)
  })

  it('sets the cookies and headers of a call on the response', async () => {
    const { client, exchanges } = createClientServer()

    await expect(client.login({ user: 'alice' })).resolves.toEqual({ user: 'alice' })

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.response.headers.getSetCookie()).toEqual(['session=alice; HttpOnly'])
    expect(exchanges[0]!.response.headers.get('cache-control')).toEqual('no-store')
  })

  it('returns errors through every plugin', async () => {
    const { client, exchanges } = createClientServer()

    const error = await client.ping({ value: -1 }).catch(e => e)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'Negative value', data: { value: -1 }, defined: false })

    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.response.status).toEqual(200)
    await expect(readJson(exchanges[0]!.response)).resolves.toEqual({
      jsonrpc: '2.0',
      id: expect.any(Number),
      error: { code: -32009, message: 'Negative value', data: { code: 'CONFLICT', defined: false, data: { value: -1 } } },
    })
  })

  it('answers JSON-RPC batch requests and rpc.discover behind the other routing plugins', async () => {
    const { handler } = createClientServer()

    const { response } = await handler.handle(new Request('http://localhost/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'ping', params: { value: 1 }, id: 1 },
        { jsonrpc: '2.0', method: 'rpc.discover', id: 2 },
      ]),
    }), {
      context: {},
      prefix: '/rpc',
    })

    expect(response?.status).toEqual(200)
    await expect(response?.json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, result: { value: 1 } },
      { jsonrpc: '2.0', id: 2, result: openRPCSpec },
    ])
  })

  it('serves the openrpc and openapi documents behind the other routing plugins', async () => {
    const { handler } = createClientServer()

    const { response: openRPCResponse } = await handler.handle(new Request('http://localhost/rpc/openrpc.json'), {
      context: {},
      prefix: '/rpc',
    })

    expect(openRPCResponse?.status).toEqual(200)
    await expect(openRPCResponse?.json()).resolves.toEqual(openRPCSpec)

    const { response: openAPIResponse } = await handler.handle(new Request('http://localhost/rpc/spec.json'), {
      context: {},
      prefix: '/rpc',
    })

    expect(openAPIResponse?.status).toEqual(200)
    await expect(openAPIResponse?.json()).resolves.toEqual(spec)
  })
})
