import type { RetryLinkPluginContext } from '@orpc/client/plugins'
import type { JsonRpcErrorResponse } from '@orpc/openrpc'
import { createORPCClient, isDefinedError, ORPCError, ResponseError, safe } from '@orpc/client'
import { RetryAfterLinkPlugin, RetryLinkPlugin } from '@orpc/client/plugins'
import { COMMON_JSON_RPC_ERROR_CODE_MAP } from '@orpc/openrpc'
import { ratelimit, RateLimitHandlerPlugin } from '@orpc/ratelimit'
import { MemoryRateLimiter } from '@orpc/ratelimit/memory'
import { asyncIteratorObject, os } from '@orpc/server'
import { z } from 'zod'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

/**
 * The JSON-RPC response an error was decoded from, kept on its `ResponseError` cause.
 */
function getJsonRpcErrorResponse(error: unknown): { status: number, body: JsonRpcErrorResponse } {
  expect(error).toBeInstanceOf(ORPCError)

  const cause = (error as ORPCError<string, unknown>).cause
  expect(cause).toBeInstanceOf(ResponseError)

  const { status, body } = (cause as ResponseError).response

  return { status, body: body as JsonRpcErrorResponse }
}

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openrpc errors: %s', (_name, createClientServer) => {
  let attempts = 0

  const router = {
    planet: {
      find: os
        .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ name: z.string() }) } })
        .input(z.object({ name: z.string() }))
        .handler(({ input, errors }) => {
          if (input.name !== 'Earth') {
            throw errors.NOT_FOUND({ data: { name: input.name } })
          }

          return { name: 'Earth' }
        }),
    },
    forbidden: os.handler(() => {
      throw new ORPCError('FORBIDDEN', { message: 'No access', data: { reason: 'private' } })
    }),
    validate: os.input(z.object({ id: z.number() })).handler(({ input }) => input.id),
    crash: os.handler(() => {
      throw new Error('database password is hunter2')
    }),
    outOfStock: os
      .errors({ OUT_OF_STOCK: { message: 'Out of stock', data: z.object({ sku: z.string() }) } })
      .handler(({ errors }) => {
        throw errors.OUT_OF_STOCK({ data: { sku: 'A1' } })
      }),
    unavailable: os.handler(() => {
      if (++attempts < 2) {
        throw new ORPCError('SERVICE_UNAVAILABLE')
      }

      return 'OK'
    }),
    stream: os.output(asyncIteratorObject(z.string())).handler(async function* () {
      yield 'never sent'
    }),
    undeclaredStream: os.handler(async function* () {
      yield 'never sent'
    }),
  }

  const { client, link, fetchSpy } = createClientServer(router)

  beforeEach(() => {
    attempts = 0
  })

  it('returns defined errors that safe recognizes', async () => {
    const { error, data, definedError, isSuccess } = await safe(client.planet.find({ name: 'Pluto' }))

    expect(isSuccess).toBe(false)
    expect(data).toBeUndefined()
    expect(isDefinedError(error)).toBe(true)
    expect(definedError).toBe(error)
    expect(definedError).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Planet not found',
      data: { name: 'Pluto' },
      defined: true,
    })

    expectTypeOf(definedError!.data).toEqualTypeOf<{ name: string }>()

    const { status, body } = getJsonRpcErrorResponse(error)
    // JSON-RPC errors arrive with 200, so the status is derived from the error code
    expect(status).toBe(404)
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: expect.any(Number),
      error: {
        code: -32004,
        message: 'Planet not found',
        data: { code: 'NOT_FOUND', defined: true, data: { name: 'Pluto' } },
      },
    })
  })

  it('returns other ORPCErrors with their code, message, and data', async () => {
    const { error, definedError } = await safe(client.forbidden())

    expect(definedError).toBe(null)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'No access',
      data: { reason: 'private' },
      defined: false,
    })
    expect(getJsonRpcErrorResponse(error).body.error.code).toBe(-32003)
  })

  it('returns validation errors as "Invalid params" (-32602) with the issues', async () => {
    const error = await client.validate({ id: 'one' as any }).catch(e => e)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Input validation failed',
      defined: false,
      data: {
        issues: [expect.objectContaining({ path: ['id'] })],
      },
    })

    const { body } = getJsonRpcErrorResponse(error)
    expect(body.error.code).toBe(-32602)
    expect(body.error.data).toMatchObject({ code: 'BAD_REQUEST', defined: false, data: { issues: expect.any(Array) } })
  })

  it('hides the message of errors that are not ORPCErrors', async () => {
    const error = await client.crash().catch(e => e)

    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error', defined: false })

    const { status, body } = getJsonRpcErrorResponse(error)
    expect(status).toBe(500)
    expect(body.error).toEqual({
      code: -32603,
      message: 'Internal Server Error',
      data: { code: 'INTERNAL_SERVER_ERROR', defined: false },
    })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })

  it('answers unknown and streaming procedures with "Method not found"', async () => {
    const anyClient = createORPCClient<any>(link)

    for (const call of [() => anyClient.planet.missing(), () => anyClient.stream()]) {
      const error = await call().catch((e: unknown) => e)

      expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Method not found', defined: false })
      expect(getJsonRpcErrorResponse(error).body.error).toEqual({ code: -32601, message: 'Method not found' })
    }
  })

  it('answers a procedure returning an undeclared stream with an internal error', async () => {
    const error = await client.undeclaredStream().catch(e => e)

    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' })
    expect(getJsonRpcErrorResponse(error).body.error.code).toBe(-32603)
  })

  it('sends errors with HTTP 200 by default', async () => {
    await expect(client.planet.find({ name: 'Pluto' })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const response: Response = await fetchSpy.mock.results.at(-1)!.value
    expect(response.status).toBe(200)
  })

  it('falls back to -32000 for codes missing from the errorCodeMap', async () => {
    const error = await client.outOfStock().catch(e => e)

    expect(error).toMatchObject({ code: 'OUT_OF_STOCK', defined: true })
    expect(getJsonRpcErrorResponse(error).body.error.code).toBe(-32000)
  })

  describe('with a custom errorCodeMap', () => {
    const { client: extendedClient } = createClientServer(router, {
      handler: { errorCodeMap: { ...COMMON_JSON_RPC_ERROR_CODE_MAP, OUT_OF_STOCK: 1001 } },
    })

    const { client: replacedClient } = createClientServer(router, {
      handler: { errorCodeMap: { OUT_OF_STOCK: 1001 } },
    })

    it('sends the mapped code', async () => {
      const error = await extendedClient.outOfStock().catch(e => e)

      // the error data carries the oRPC code, so the client restores it whatever the integer code is
      expect(error).toMatchObject({ code: 'OUT_OF_STOCK', message: 'Out of stock', data: { sku: 'A1' }, defined: true })
      expect(getJsonRpcErrorResponse(error).body.error.code).toBe(1001)

      const commonError = await extendedClient.forbidden().catch(e => e)
      expect(getJsonRpcErrorResponse(commonError).body.error.code).toBe(-32003)
    })

    it('replaces the default errorCodeMap', async () => {
      const error = await replacedClient.forbidden().catch(e => e)

      expect(error).toMatchObject({ code: 'FORBIDDEN', message: 'No access', defined: false })
      expect(getJsonRpcErrorResponse(error).body.error.code).toBe(-32000)
    })
  })

  describe('with errorResponseStatus: "mapped"', () => {
    const { client, link, fetchSpy } = createClientServer(router, {
      handler: { errorResponseStatus: 'mapped' },
    })

    async function lastResponseStatus(): Promise<number> {
      const response: Response = await fetchSpy.mock.results.at(-1)!.value
      return response.status
    }

    it('sends single errors with their mapped HTTP status', async () => {
      await expect(client.planet.find({ name: 'Pluto' })).rejects.toMatchObject({ code: 'NOT_FOUND', defined: true })
      expect(await lastResponseStatus()).toBe(404)

      await expect(client.validate({ id: 'one' as any })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(await lastResponseStatus()).toBe(400)

      await expect(client.crash()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
      expect(await lastResponseStatus()).toBe(500)

      await expect(createORPCClient<any>(link).missing()).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(await lastResponseStatus()).toBe(404)

      await expect(client.planet.find({ name: 'Earth' })).resolves.toEqual({ name: 'Earth' })
      expect(await lastResponseStatus()).toBe(200)
    })
  })

  describe('with rate limiting', () => {
    /**
     * Created by each test, so its window starts with the test.
     */
    let limiter = new MemoryRateLimiter({ maxRequests: 1, window: 60_000 })

    const limitedRouter = {
      limited: os.use(ratelimit({ limiter: () => limiter, key: 'key' })).handler(() => 'ok'),
    }

    const mapped = createClientServer(limitedRouter, {
      handler: { errorResponseStatus: 'mapped', plugins: [new RateLimitHandlerPlugin()] },
      link: { plugins: [new RetryAfterLinkPlugin()] },
    })

    const always200 = createClientServer(limitedRouter, {
      handler: { plugins: [new RateLimitHandlerPlugin()] },
      link: { plugins: [new RetryAfterLinkPlugin()] },
    })

    it('lets RetryAfterLinkPlugin wait and retry with errorResponseStatus: "mapped"', async () => {
      const { client, fetchSpy } = mapped
      // retry-after is rounded up to 1 second, by which time the 500ms window has reset
      limiter = new MemoryRateLimiter({ maxRequests: 1, window: 500 })

      await expect(client.limited()).resolves.toBe('ok')
      await expect(client.limited()).resolves.toBe('ok')

      expect(fetchSpy).toHaveBeenCalledTimes(3)

      const limitedResponse: Response = await fetchSpy.mock.results[1]!.value
      expect(limitedResponse.status).toBe(429)
      expect(limitedResponse.headers.get('retry-after')).toBe('1')
    })

    it('forwards retry-after with HTTP 200 by default, which RetryAfterLinkPlugin does not retry', async () => {
      const { client, fetchSpy } = always200
      limiter = new MemoryRateLimiter({ maxRequests: 1, window: 60_000 })

      await expect(client.limited()).resolves.toBe('ok')

      const error = await client.limited().catch(e => e)
      expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', defined: false })
      expect(getJsonRpcErrorResponse(error).status).toBe(429)

      expect(fetchSpy).toHaveBeenCalledTimes(2)

      const limitedResponse: Response = await fetchSpy.mock.results[1]!.value
      expect(limitedResponse.status).toBe(200)
      expect(limitedResponse.headers.get('retry-after')).toEqual(expect.any(String))
      expect(limitedResponse.headers.get('ratelimit-remaining')).toBe('0')
    })
  })

  describe('with RetryLinkPlugin', () => {
    const { client, fetchSpy } = createClientServer<typeof router, RetryLinkPluginContext>(router, {
      link: { plugins: [new RetryLinkPlugin({ default: { retry: 3, retryDelay: 0 } })] },
    })

    beforeEach(() => {
      fetchSpy.mockClear()
    })

    it('does not retry client errors delivered with HTTP 200', async () => {
      await expect(client.validate({ id: 'one' as any })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      await expect(client.planet.find({ name: 'Pluto' })).rejects.toMatchObject({ code: 'NOT_FOUND', defined: true })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('retries server errors delivered with HTTP 200', async () => {
      await expect(client.unavailable()).resolves.toBe('OK')

      expect(fetchSpy).toHaveBeenCalledTimes(2)

      const first: Response = await fetchSpy.mock.results[0]!.value
      expect(first.status).toBe(200)
    })

    it('sends every attempt with a new request id', async () => {
      await expect(client.unavailable()).resolves.toBe('OK')

      const ids = fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body as string).id)
      expect(ids).toHaveLength(2)
      expect(new Set(ids).size).toBe(2)
    })
  })
})
