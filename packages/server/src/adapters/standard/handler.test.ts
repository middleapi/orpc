/* eslint-disable no-restricted-imports */

import { ROOT_CONTEXT } from '@opentelemetry/api'
import { ORPCError } from '@orpc/client'
import * as sharedExperimental from '@orpc/shared'
import { createProcedureClient } from '../../procedure-client'
import { StandardHandler } from './handler'

vi.mock('../../procedure-client', () => ({
  createProcedureClient: vi.fn(),
}))

const OK_RESPONSE = { status: 200, headers: {}, body: 'ok' }

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    url: '/api/v1/ping',
    headers: {},
    signal: new AbortController().signal,
    ...overrides,
  } as any
}

function makeCodec() {
  return {
    resolveProcedure: vi.fn(),
    encodeOutput: vi.fn(),
    encodeError: vi.fn(),
  }
}

function makeResolved(overrides: Record<string, unknown> = {}) {
  return {
    path: ['ping'],
    procedure: {} as any,
    decodeInput: vi.fn().mockResolvedValue('__input__'),
    ...overrides,
  }
}

describe('standardHandler', () => {
  const OPTIONS = { context: {}, prefix: '/api/v1' } as const

  let codec: ReturnType<typeof makeCodec>
  let client: ReturnType<typeof vi.fn>
  let handler: StandardHandler<any>

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    codec = makeCodec()
    client = vi.fn().mockResolvedValue('__output__')
    vi.mocked(createProcedureClient).mockReturnValue(client as any)
    handler = new StandardHandler(codec as any, {})
  })

  function setupHappyPath(resolvedOverrides?: Record<string, unknown>) {
    const resolved = makeResolved(resolvedOverrides)
    codec.resolveProcedure.mockResolvedValue(resolved)
    codec.encodeOutput.mockResolvedValue(OK_RESPONSE)
    return resolved
  }

  it('workflow is correct', async () => {
    const routingInterceptor = vi.fn(({ next }) => next())
    const interceptor = vi.fn(({ next }) => next())
    const clientInterceptor = vi.fn()

    codec = makeCodec()
    client = vi.fn().mockResolvedValue('__output__')
    vi.mocked(createProcedureClient).mockReturnValue(client as any)

    handler = new StandardHandler(codec as any, {
      routingInterceptors: [routingInterceptor],
      interceptors: [interceptor],
      clientInterceptors: [clientInterceptor],
    })

    const resolved = makeResolved()
    codec.resolveProcedure.mockResolvedValue(resolved)
    codec.encodeOutput.mockResolvedValue(OK_RESPONSE)

    const request = makeRequest()
    const result = await handler.handle(request, OPTIONS)

    expect(result).toEqual({ matched: true, response: OK_RESPONSE })

    expect(codec.resolveProcedure).toHaveBeenCalledTimes(1)
    expect(codec.resolveProcedure).toHaveBeenCalledWith(request, OPTIONS)

    expect(resolved.decodeInput).toHaveBeenCalledTimes(1)

    expect(createProcedureClient).toHaveBeenCalledTimes(1)
    expect(createProcedureClient).toHaveBeenCalledWith(resolved.procedure, {
      context: OPTIONS.context,
      path: ['ping'],
      interceptors: [clientInterceptor],
    })

    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toHaveBeenCalledWith('__input__', {
      signal: request.signal,
      lastEventId: undefined,
    })

    expect(codec.encodeOutput).toHaveBeenCalledTimes(1)
    expect(codec.encodeOutput).toHaveBeenCalledWith('__output__', resolved.procedure, ['ping'], OPTIONS)

    expect(codec.encodeError).not.toHaveBeenCalled()

    expect(routingInterceptor).toHaveBeenCalledTimes(1)
    expect(routingInterceptor).toHaveBeenCalledWith({
      next: expect.any(Function),
      request,
      context: OPTIONS.context,
      prefix: OPTIONS.prefix,
    })
    await expect(routingInterceptor.mock.results[0]!.value).resolves.toEqual({ matched: true, response: OK_RESPONSE })

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveBeenCalledWith({
      next: expect.any(Function),
      request,
      path: ['ping'],
      procedure: resolved.procedure,
      decodeInput: resolved.decodeInput,
      context: OPTIONS.context,
      prefix: OPTIONS.prefix,
    })
    await expect(interceptor.mock.results[0]!.value).resolves.toEqual(OK_RESPONSE)
  })

  describe('prefix matching', () => {
    it('returns unmatched when URL does not start with prefix', async () => {
      const result = await handler.handle(makeRequest({ url: '/other/ping' }), OPTIONS)

      expect(result).toEqual({ matched: false })
      expect(codec.resolveProcedure).not.toHaveBeenCalled()
    })

    it.each([
      ['/api/v1/ping', '/api/v1', 'path after prefix'],
      ['/api/v1?foo=bar', '/api/v1', 'query string'],
      ['/api/v1#fragment', '/api/v1', 'hash fragment'],
      ['/api/v1', '/api/v1', 'exact match'],
      ['/api/v1/users', '/api/v1/', 'trailing slash prefix'],
    ] as const)('matches URL=%s with prefix=%s (%s)', async (url, prefix, _description) => {
      codec.resolveProcedure.mockResolvedValue(undefined)

      await handler.handle(makeRequest({ url }), { context: {}, prefix })

      expect(codec.resolveProcedure).toHaveBeenCalledOnce()
    })

    it('skips prefix check when prefix is undefined', async () => {
      codec.resolveProcedure.mockResolvedValue(undefined)

      await handler.handle(makeRequest({ url: '/anything' }), { context: {} })

      expect(codec.resolveProcedure).toHaveBeenCalledOnce()
    })
  })

  describe('procedure resolution', () => {
    it('returns unmatched when codec resolves no procedure', async () => {
      codec.resolveProcedure.mockResolvedValue(undefined)
      const request = makeRequest()

      const result = await handler.handle(request, OPTIONS)

      expect(result).toEqual({ matched: false })
      expect(codec.resolveProcedure).toHaveBeenCalledWith(request, OPTIONS)
      expect(codec.encodeOutput).not.toHaveBeenCalled()
      expect(codec.encodeError).not.toHaveBeenCalled()
    })
  })

  describe('successful procedure call', () => {
    it('decodes input, calls procedure client, and encodes output', async () => {
      const resolved = setupHappyPath()
      const request = makeRequest()

      const result = await handler.handle(request, OPTIONS)

      expect(result).toEqual({ matched: true, response: OK_RESPONSE })
      expect(resolved.decodeInput).toHaveBeenCalledOnce()
      expect(client).toHaveBeenCalledWith('__input__', expect.objectContaining({ signal: request.signal }))
      expect(codec.encodeOutput).toHaveBeenCalledWith('__output__', resolved.procedure, ['ping'], OPTIONS)
      expect(codec.encodeError).not.toHaveBeenCalled()
    })

    it('passes clientInterceptors to createProcedureClient', async () => {
      setupHappyPath()
      const clientInterceptor = vi.fn()

      handler = new StandardHandler(codec as any, { clientInterceptors: [clientInterceptor] })
      await handler.handle(makeRequest(), OPTIONS)

      expect(createProcedureClient).toHaveBeenCalledWith(expect.anything(), {
        context: OPTIONS.context,
        path: ['ping'],
        interceptors: [clientInterceptor],
      })
    })

    it('flattens last-event-id header array and passes to client', async () => {
      setupHappyPath()

      await handler.handle(
        makeRequest({ headers: { 'last-event-id': ['event-a', 'event-b'] } }),
        OPTIONS,
      )

      expect(client.mock.calls[0]?.[1]?.lastEventId).toBe('event-a, event-b')
    })

    it('passes undefined lastEventId when header is absent', async () => {
      setupHappyPath()

      await handler.handle(makeRequest(), OPTIONS)

      expect(client.mock.calls[0]?.[1]?.lastEventId).toBeUndefined()
    })

    it('safely traces async iterator input', async () => {
      async function* input() {
        yield 'e1'
        yield 'e2'
      }

      setupHappyPath({ decodeInput: vi.fn().mockResolvedValue(input()) })
      client.mockImplementation(async (iter: AsyncIterable<unknown>) => {
        const out: unknown[] = []
        for await (const v of iter) out.push(v)
        return out
      })

      const result = await handler.handle(makeRequest(), OPTIONS)

      expect(result).toEqual({ matched: true, response: OK_RESPONSE })
      expect(codec.encodeOutput).toHaveBeenCalledWith(['e1', 'e2'], expect.anything(), ['ping'], expect.anything())
    })
  })

  describe('error handling', () => {
    it('wraps non-ORPCError decode failures as BAD_REQUEST', async () => {
      const cause = new Error('invalid body')
      codec.resolveProcedure.mockResolvedValue(
        makeResolved({ decodeInput: vi.fn().mockRejectedValue(cause) }),
      )
      codec.encodeError.mockResolvedValue({ status: 400, headers: {}, body: 'bad request' })

      const result = await handler.handle(makeRequest(), OPTIONS)

      expect(result).toEqual({ matched: true, response: { status: 400, headers: {}, body: 'bad request' } })
      expect(createProcedureClient).not.toHaveBeenCalled()

      const error = codec.encodeError.mock.calls[0]?.[0]
      expect(error).toBeInstanceOf(ORPCError)
      expect(error.code).toBe('BAD_REQUEST')
      expect(error.cause).toBe(cause)
    })

    it('passes ORPCError decode failures through without wrapping', async () => {
      const orpcError = new ORPCError('PAYLOAD_TOO_LARGE')
      codec.resolveProcedure.mockResolvedValue(
        makeResolved({ decodeInput: vi.fn().mockRejectedValue(orpcError) }),
      )
      codec.encodeError.mockResolvedValue({ status: 413, headers: {}, body: 'too large' })

      const result = await handler.handle(makeRequest(), OPTIONS)

      expect(result).toEqual({ matched: true, response: { status: 413, headers: {}, body: 'too large' } })
      expect(codec.encodeError.mock.calls[0]?.[0]).toBe(orpcError)
    })

    it('encodes ORPCError from procedure call as-is', async () => {
      const procedureError = new ORPCError('BAD_GATEWAY')
      client.mockRejectedValue(procedureError)

      codec.resolveProcedure.mockResolvedValue(makeResolved())
      codec.encodeError.mockResolvedValue({ status: 502, headers: {}, body: 'bad gateway' })

      const result = await handler.handle(makeRequest(), OPTIONS)

      expect(result).toEqual({ matched: true, response: { status: 502, headers: {}, body: 'bad gateway' } })
      expect(codec.encodeError).toHaveBeenCalledWith(procedureError, expect.anything(), ['ping'], OPTIONS)
    })

    it('wraps non-ORPCError from procedure call as INTERNAL_SERVER_ERROR', async () => {
      client.mockRejectedValue(new Error('unexpected'))

      codec.resolveProcedure.mockResolvedValue(makeResolved())
      codec.encodeError.mockResolvedValue({ status: 500, headers: {}, body: 'internal' })

      await handler.handle(makeRequest(), OPTIONS)

      const error = codec.encodeError.mock.calls[0]?.[0]
      expect(error).toBeInstanceOf(ORPCError)
      expect(error.code).toBe('INTERNAL_SERVER_ERROR')
    })
  })

  describe('plugins', () => {
    it('initializes plugins and applies their routing interceptors', async () => {
      const pluginInterceptor = vi.fn(async () => ({
        matched: true as const,
        response: { status: 200, headers: {}, body: 'from-plugin' },
      }))

      const plugin = {
        name: 'test-plugin',
        init: vi.fn((options: any) => ({
          ...options,
          routingInterceptors: [pluginInterceptor],
        })),
      }

      handler = new StandardHandler(codec as any, { plugins: [plugin] })
      const result = await handler.handle(makeRequest(), OPTIONS)

      expect(plugin.init).toHaveBeenCalledOnce()
      expect(pluginInterceptor).toHaveBeenCalledOnce()
      expect(result).toEqual({ matched: true, response: { status: 200, headers: {}, body: 'from-plugin' } })
      expect(codec.resolveProcedure).not.toHaveBeenCalled()
    })
  })

  describe('openTelemetry', () => {
    it('extracts propagation context from request headers', async () => {
      codec.resolveProcedure.mockResolvedValue(undefined)

      const activeContext = ROOT_CONTEXT
      const extract = vi.fn(() => ROOT_CONTEXT)
      const active = vi.fn(() => activeContext)

      vi.spyOn(sharedExperimental, 'getOpenTelemetryConfig').mockReturnValue({
        trace: { getActiveSpan: () => undefined },
        context: { active } as any,
        propagation: { extract } as any,
      } as any)

      const request = makeRequest({ headers: { traceparent: '00-test' } })
      await handler.handle(request, OPTIONS)

      expect(active).toHaveBeenCalledOnce()
      expect(extract).toHaveBeenCalledWith(activeContext, request.headers)
    })
  })
})
