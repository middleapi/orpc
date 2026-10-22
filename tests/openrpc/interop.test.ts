import type { ContractRouterClient } from '@orpc/contract'
import type { OpenRPCClient } from '@orpc/openrpc'
import type { AddressInfo } from 'node:net'
import * as http from 'node:http'
import { Client, HTTPTransport, JSONRPCError, RequestManager } from '@open-rpc/client-js'
import { createORPCClient, MalformedResponseError, ORPCError, ResponseError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { OpenRPCGenerator } from '@orpc/openrpc'
import { OpenRPCLink } from '@orpc/openrpc/fetch'
import { OpenRPCDiscoveryHandlerPlugin } from '@orpc/openrpc/plugins'
import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { sleep } from '@standard-server/shared'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('@open-rpc/client-js against OpenRPCHandler: %s', (_name, createClientServer) => {
  const logs: string[] = []

  const router = {
    planet: {
      find: os
        .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ name: z.string() }) } })
        .input(z.object({ name: z.string() }))
        .handler(({ input, errors }) => {
          if (input.name !== 'Earth') {
            throw errors.NOT_FOUND({ data: { name: input.name } })
          }

          return { name: 'Earth', discoveredAt: new Date('2024-01-02T03:04:05.000Z') }
        }),
    },
    math: {
      square: os.input(z.number()).handler(({ input }) => input * input),
    },
    ping: os.handler(() => 'pong'),
    log: os
      .input(z.object({ message: z.string() }))
      .handler(async ({ input }) => {
        await sleep(20)
        logs.push(input.message)
      }),
  }

  const spec = new OpenRPCGenerator({ converters: [new ZodToJsonSchemaConverter()] })
    .generate(router, { base: { info: { title: 'Interop', version: '1.0.0' } } })

  const { url } = createClientServer(router, {
    handler: { plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: () => spec })] },
  })

  const client = new Client(new RequestManager([new HTTPTransport(url)]))

  beforeEach(() => {
    logs.length = 0
  })

  afterAll(() => {
    client.close()
  })

  it('calls methods with params by-name', async () => {
    await expect(client.request({ method: 'planet.find', params: { name: 'Earth' } })).resolves.toEqual({
      name: 'Earth',
      discoveredAt: '2024-01-02T03:04:05.000Z',
    })
  })

  it('calls methods with params by-position', async () => {
    await expect(client.request({ method: 'math.square', params: [3] })).resolves.toBe(9)
  })

  it('calls methods without params', async () => {
    // client-js sends `params: []` when none are given
    await expect(client.request({ method: 'ping' })).resolves.toBe('pong')
  })

  it('receives the error code, message, and data', async () => {
    const error = await client.request({ method: 'planet.find', params: { name: 'Pluto' } }).catch(e => e)

    expect(error).toBeInstanceOf(JSONRPCError)
    expect(error).toMatchObject({
      code: -32004,
      message: 'Planet not found',
      data: { code: 'NOT_FOUND', defined: true, data: { name: 'Pluto' } },
    })
  })

  it('receives "Invalid params" and "Method not found"', async () => {
    await expect(client.request({ method: 'math.square', params: ['three'] })).rejects.toMatchObject({
      code: -32602,
      message: 'Input validation failed',
      data: { code: 'BAD_REQUEST', defined: false, data: { issues: expect.any(Array) } },
    })

    const error = await client.request({ method: 'planet.missing' }).catch(e => e)
    expect(error).toBeInstanceOf(JSONRPCError)
    expect(error.code).toBe(-32601)
    expect(error.message).toBe('Method not found')
    expect(error.data).toBeUndefined()
  })

  it('sends notifications', async () => {
    await expect(client.notify({ method: 'log', params: { message: 'hello' } })).resolves.toBeUndefined()

    // the handler runs a notification to completion before answering
    expect(logs).toEqual(['hello'])
  })

  it('sends batch requests', async () => {
    client.startBatch()
    const square = client.request({ method: 'math.square', params: [4] })
    const missing = client.request({ method: 'planet.find', params: { name: 'Pluto' } })
    const ping = client.request({ method: 'ping' })
    client.stopBatch()

    await expect(square).resolves.toBe(16)
    await expect(missing).rejects.toMatchObject({ code: -32004, message: 'Planet not found' })
    await expect(ping).resolves.toBe('pong')
  })

  it('discovers the service with rpc.discover', async () => {
    const document = await client.request({ method: 'rpc.discover' })

    expect(document).toEqual(await spec)
    expect(document).toMatchObject({ openrpc: '1.3.2', info: { title: 'Interop', version: '1.0.0' } })
    expect(document.methods.map((method: { name: string }) => method.name)).toEqual(['planet.find', 'math.square', 'ping', 'log'])
  })

  it('calls every method with params built from the document', async () => {
    const document = await client.request({ method: 'rpc.discover' })

    const calls: Record<string, { paramStructure: string | undefined, input: unknown, result: unknown }> = {
      'planet.find': { paramStructure: 'by-name', input: { name: 'Earth' }, result: { name: 'Earth', discoveredAt: '2024-01-02T03:04:05.000Z' } },
      'math.square': { paramStructure: 'by-position', input: 5, result: 25 },
      'ping': { paramStructure: undefined, input: undefined, result: 'pong' },
      'log': { paramStructure: 'by-name', input: { message: 'from the document' }, result: null },
    }

    for (const method of document.methods) {
      const { paramStructure, input, result } = calls[method.name]!

      expect(method.paramStructure).toBe(paramStructure)

      // by-name params are the input object, by-position params its only element
      const params = method.paramStructure === 'by-name'
        ? input as object
        : method.params.length === 0 ? undefined : [input]

      await expect(client.request({ method: method.name, params })).resolves.toEqual(result)
    }

    expect(logs).toEqual(['from the document'])
  })
})

/**
 * A minimal JSON-RPC server that knows nothing about oRPC: it answers errors without oRPC error data.
 */
function createForeignServer() {
  const received: { body: any }[] = []

  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
    }

    const request = JSON.parse(raw)
    received.push({ body: request })

    if (!Object.hasOwn(request, 'id')) {
      res.writeHead(204).end()
      return
    }

    const reply = (member: object, id: unknown = request.id) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...member }))
    }

    switch (request.method) {
      case 'subtract':
        return reply({ result: request.params[0] - request.params[1] })
      case 'echo':
        return reply({ result: request.params ?? null })
      case 'fail':
        return reply({ error: { code: request.params.code, message: `Failure ${request.params.code}`, data: request.params.data } })
      case 'wrongId':
        return reply({ result: 'ok' }, 'not-the-request-id')
      default:
        return reply({ error: { code: -32601, message: 'Method not found' } })
    }
  })

  server.listen(0)

  afterAll(() => {
    server.close()
  })

  return {
    origin: `http://localhost:${(server.address() as AddressInfo).port}`,
    received,
  }
}

describe('openRPCLink against a foreign JSON-RPC server', () => {
  const contract = {
    subtract: oc.input(z.tuple([z.number(), z.number()])).output(z.number()),
    echo: oc.input(z.unknown()).output(z.unknown()),
    fail: oc.input(z.object({ code: z.number(), data: z.unknown().optional() })),
    log: oc.input(z.object({ message: z.string() })),
    wrongId: oc.output(z.string()),
    missing: oc,
  }

  type ForeignClient = OpenRPCClient<ContractRouterClient<typeof contract>>

  const { origin, received } = createForeignServer()

  const client = createORPCClient<ForeignClient>(new OpenRPCLink({ origin }))

  beforeEach(() => {
    received.length = 0
  })

  it('sends params by-name or by-position by default', async () => {
    await expect(client.echo({ a: 1 })).resolves.toEqual({ a: 1 })
    expect(received.at(-1)!.body).toEqual({ jsonrpc: '2.0', method: 'echo', params: { a: 1 }, id: expect.any(Number) })

    await expect(client.echo('x')).resolves.toEqual(['x'])
    expect(received.at(-1)!.body).toMatchObject({ params: ['x'] })

    await expect(client.echo(undefined)).resolves.toBe(null)
    expect(received.at(-1)!.body).not.toHaveProperty('params')
  })

  it('spreads a tuple into positional params with encodeParams', async () => {
    const client = createORPCClient<ForeignClient>(new OpenRPCLink({
      origin,
      encodeParams: input => input as unknown[],
    }))

    await expect(client.subtract([42, 23])).resolves.toBe(19)
    expect(received.at(-1)!.body).toMatchObject({ method: 'subtract', params: [42, 23] })
  })

  it.each([
    [-32700, 'BAD_REQUEST', 400],
    [-32600, 'BAD_REQUEST', 400],
    [-32601, 'NOT_FOUND', 404],
    [-32602, 'BAD_REQUEST', 400],
    [-32603, 'INTERNAL_SERVER_ERROR', 500],
    [-32000, 'INTERNAL_SERVER_ERROR', 500],
    [-32001, 'UNAUTHORIZED', 401],
    [-32004, 'NOT_FOUND', 404],
    [-32029, 'TOO_MANY_REQUESTS', 429],
    [1001, 'INTERNAL_SERVER_ERROR', 500],
  ])('decodes the foreign error code %i as %s', async (code, orpcCode, status) => {
    const error = await client.fail({ code, data: { balance: 0 } }).catch(e => e)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      code: orpcCode,
      message: `Failure ${code}`,
      data: { balance: 0 },
      defined: false,
    })

    const cause = (error as ORPCError<string, unknown>).cause
    expect(cause).toBeInstanceOf(ResponseError)
    expect((cause as ResponseError).message).toBe(`Received JSON-RPC error ${code}.`)
    // derived from the oRPC code, since the error arrived with 200
    expect((cause as ResponseError).response.status).toBe(status)
  })

  it('decodes a foreign "Method not found"', async () => {
    await expect(client.missing()).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Method not found', defined: false })
  })

  it('lets customErrorDecoder convert foreign errors', async () => {
    const client = createORPCClient<ForeignClient>(new OpenRPCLink({
      origin,
      customErrorDecoder: error => error.code === 1001
        ? new ORPCError('PAYMENT_REQUIRED', { message: error.message, data: error.data })
        : undefined,
    }))

    await expect(client.fail({ code: 1001, data: { balance: 0 } })).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      message: 'Failure 1001',
      data: { balance: 0 },
    })

    await expect(client.fail({ code: -32601 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('sends notifications without an id', async () => {
    const client = createORPCClient<ForeignClient>(new OpenRPCLink({
      origin,
      notification: (_options, path) => path[0] === 'log',
    }))

    await expect(client.log({ message: 'hello' })).resolves.toBeUndefined()
    expect(received.at(-1)!.body).toEqual({ jsonrpc: '2.0', method: 'log', params: { message: 'hello' } })

    // other calls are still requests
    await expect(client.echo(1)).resolves.toEqual([1])
    expect(received.at(-1)!.body).toHaveProperty('id')
  })

  it('rejects a response whose id does not match the request', async () => {
    const error = await client.wrongId().catch(e => e)

    expect(error).toBeInstanceOf(MalformedResponseError)
    expect(error.message).toBe('JSON-RPC response id does not match the request id.')
  })
})
