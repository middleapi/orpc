import { ORPCError } from '@orpc/client'
import * as z from 'zod'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { RPC_DEFAULT_ALLOW_METHODS } from '../adapters/standard'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { CORSHandlerPlugin } from './cors'
import { CsrfProtectionHandlerPlugin } from './csrf-protection'
import { GetMethodCsrfProtectionHandlerPlugin } from './get-method-csrf-protection'

function makeRequest(headers: Record<string, unknown>, method: string) {
  return {
    method,
    url: '/ping',
    headers,
    signal: new AbortController().signal,
  } as any
}

function getPlugin(options?: ConstructorParameters<typeof CsrfProtectionHandlerPlugin<any>>[0]) {
  const existingInterceptor = vi.fn()

  const handlerOptions = new CsrfProtectionHandlerPlugin<any>(options).init({
    interceptors: [existingInterceptor],
  } as any)

  return {
    interceptor: handlerOptions.interceptors![0]!,
    existingInterceptor,
    handlerOptions,
  }
}

function invokeInterceptor(
  headers: Record<string, unknown>,
  method = 'POST',
  options?: ConstructorParameters<typeof CsrfProtectionHandlerPlugin<any>>[0],
) {
  const nextResult = { status: 200, headers: {}, body: 'ok' }
  const next = vi.fn().mockResolvedValue(nextResult)
  const { interceptor } = getPlugin(options)
  const interceptorOptions = { context: {}, request: makeRequest(headers, method), next } as any

  const result = (async () => interceptor(interceptorOptions))()

  return { result, next, nextResult, interceptorOptions }
}

async function expectAllowed(
  headers: Record<string, unknown>,
  method = 'POST',
  options?: ConstructorParameters<typeof CsrfProtectionHandlerPlugin<any>>[0],
) {
  const { result, next, nextResult } = invokeInterceptor(headers, method, options)

  await expect(result).resolves.toBe(nextResult)
  expect(next).toHaveBeenCalledOnce()
}

async function expectBlocked(
  headers: Record<string, unknown>,
  method = 'POST',
  options?: ConstructorParameters<typeof CsrfProtectionHandlerPlugin<any>>[0],
) {
  const { result, next } = invokeInterceptor(headers, method, options)

  await expect(result).rejects.toSatisfy(error =>
    error instanceof ORPCError
    && error.code === 'FORBIDDEN'
    && error.message === 'Request blocked by CSRF protection.')
  expect(next).not.toHaveBeenCalled()
}

const CROSS_SITE = {
  'sec-fetch-site': 'cross-site',
  'origin': 'https://evil.example',
}

describe('csrfProtectionHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registration', () => {
    it('prepends its interceptor so it runs before existing ones', () => {
      const { handlerOptions, existingInterceptor } = getPlugin()

      expect(handlerOptions.interceptors).toHaveLength(2)
      expect(handlerOptions.interceptors![1]).toBe(existingInterceptor)
    })
  })

  describe('guarded methods', () => {
    it.each([
      'GET',
      'HEAD',
      'OPTIONS',
    ])('ignores the safe %s method', async (method) => {
      await expectAllowed(CROSS_SITE, method)
    })

    it.each([
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'QUERY',
    ])('guards %s requests', async (method) => {
      await expectBlocked(CROSS_SITE, method)
    })
  })

  describe('fetch site', () => {
    it.each([
      'same-origin',
      'SAME-ORIGIN',
      'same-site',
      'none',
    ])('trusts sec-fetch-site %s even from an untrusted origin', async (site) => {
      await expectAllowed({ ...CROSS_SITE, 'sec-fetch-site': site })
    })

    it.each([
      'cross-site',
      'Cross-Site',
      'future-value',
    ])('blocks sec-fetch-site %s from an untrusted origin', async (site) => {
      await expectBlocked({ ...CROSS_SITE, 'sec-fetch-site': site })
    })

    it('judges a repeated sec-fetch-site header like a cross-site one', async () => {
      await expectBlocked({ ...CROSS_SITE, 'sec-fetch-site': ['same-origin', 'same-origin'] })
    })

    it('blocks a cross-site request whose origin header was stripped', async () => {
      await expectBlocked({ 'sec-fetch-site': 'cross-site' })
    })

    it('ignores the host header when sec-fetch-site is present', async () => {
      await expectBlocked({ ...CROSS_SITE, origin: 'https://api.example.com', host: 'api.example.com' })
    })
  })

  describe('requests without fetch metadata', () => {
    it('allows a request with neither sec-fetch-site nor origin, as non-browser clients send', async () => {
      await expectAllowed({})
    })

    it.each([
      ['host', { origin: 'https://api.example.com', host: 'api.example.com' }],
      ['host with a port', { origin: 'http://localhost:3000', host: 'localhost:3000' }],
      ['host matching case loosely', { origin: 'https://api.example.com', host: 'API.example.com' }],
      [':authority on HTTP/2', { 'origin': 'https://api.example.com', ':authority': 'api.example.com' }],
    ])('allows an origin matching the %s', async (_, headers) => {
      await expectAllowed(headers)
    })

    it.each([
      ['a different host', { origin: 'https://evil.example', host: 'api.example.com' }],
      ['a sibling subdomain', { origin: 'https://app.example.com', host: 'api.example.com' }],
      ['a different port', { origin: 'http://localhost:4000', host: 'localhost:3000' }],
      ['a missing host', { origin: 'https://api.example.com' }],
      ['an opaque origin', { origin: 'null', host: 'api.example.com' }],
      ['a malformed origin', { origin: 'not a url', host: 'api.example.com' }],
    ])('blocks an origin with %s', async (_, headers) => {
      await expectBlocked(headers)
    })
  })

  describe('trusted origins', () => {
    const trustedOrigins = ['https://app.example.com']

    it('allows a cross-site request from a trusted origin', async () => {
      await expectAllowed({ ...CROSS_SITE, origin: 'https://app.example.com' }, 'POST', { trustedOrigins })
    })

    it('allows a trusted origin when fetch metadata is absent and the host differs', async () => {
      await expectAllowed({ origin: 'https://app.example.com', host: 'api.example.com' }, 'POST', { trustedOrigins })
    })

    it.each([
      ['an untrusted origin', 'https://evil.example'],
      ['a different scheme', 'http://app.example.com'],
      ['a different port', 'https://app.example.com:8443'],
      ['a trailing slash', 'https://app.example.com/'],
      ['a suffix', 'https://app.example.com.evil.example'],
    ])('matches the array form exactly, blocking %s', async (_, origin) => {
      await expectBlocked({ ...CROSS_SITE, origin }, 'POST', { trustedOrigins })
    })

    it('blocks a cross-site request without an origin even when origins are trusted', async () => {
      await expectBlocked({ 'sec-fetch-site': 'cross-site' }, 'POST', { trustedOrigins })
    })

    it('calls the function form with the origin and the interceptor options', async () => {
      const trust = vi.fn(async (origin: string) => origin === 'https://app.example.com')
      const allowed = invokeInterceptor({ ...CROSS_SITE, origin: 'https://app.example.com' }, 'POST', { trustedOrigins: trust })

      await expect(allowed.result).resolves.toBe(allowed.nextResult)
      expect(trust).toHaveBeenCalledExactlyOnceWith('https://app.example.com', allowed.interceptorOptions)

      await expectBlocked(CROSS_SITE, 'POST', { trustedOrigins: trust })
      await expectBlocked({ origin: 'https://evil.example', host: 'api.example.com' }, 'POST', { trustedOrigins: trust })
    })

    it('does not consult the function form for requests it trusts already', async () => {
      const trust = vi.fn(() => false)

      await expectAllowed({ ...CROSS_SITE, 'sec-fetch-site': 'same-origin' }, 'POST', { trustedOrigins: trust })
      await expectAllowed({ origin: 'https://api.example.com', host: 'api.example.com' }, 'POST', { trustedOrigins: trust })
      await expectAllowed(CROSS_SITE, 'GET', { trustedOrigins: trust })
      expect(trust).not.toHaveBeenCalled()
    })
  })
})

describe('cross-site form CSRF', () => {
  function createRouter(calls: unknown[]) {
    const transfer = os.$context<{ headers: Headers }>()
      .use(({ context, next }) => {
        if (!context.headers.get('cookie')?.includes('session=victim'))
          throw new ORPCError('UNAUTHORIZED')
        return next({ context: { user: 'victim' } })
      })
      .input(z.object({ to: z.string(), amount: z.coerce.number() }))
      .handler(({ input, context }) => {
        calls.push({ input, user: context.user })
        return { ok: true }
      })
    return { transfer }
  }

  // What a browser sends for a cross-site
  // <form method=POST enctype=multipart/form-data action=https://app.example.com/rpc/transfer>
  //   <input name=data value='{"json":{"to":"attacker","amount":1000}}'>
  async function crossSiteMultipartPost(overrides: Record<string, string> = {}) {
    const fd = new FormData()
    fd.append('data', JSON.stringify({ json: { to: 'attacker', amount: 1000 } }))
    const encoded = new Response(fd)
    return new Request('https://app.example.com/rpc/transfer', {
      method: 'POST',
      headers: {
        'content-type': encoded.headers.get('content-type')!,
        'cookie': 'session=victim',
        'origin': 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        ...overrides,
      },
      body: await encoded.arrayBuffer(),
    })
  }

  async function run(handler: RPCHandler<any>, request: Request) {
    return handler.handle(request, { prefix: '/rpc', context: { headers: request.headers } })
  }

  describe('without an all-method guard', () => {
    it('migration guide v2 config runs the procedure with attacker input', async () => {
      const calls: unknown[] = []
      const handler = new RPCHandler(createRouter(calls), {
        allowMethods: ['GET', ...RPC_DEFAULT_ALLOW_METHODS],
        plugins: [new GetMethodCsrfProtectionHandlerPlugin()],
      })
      const { response } = await run(handler, await crossSiteMultipartPost())
      expect(response?.status).toBe(200)
      expect(calls).toEqual([{ input: { to: 'attacker', amount: 1000 }, user: 'victim' }])
    })

    it('no-cors fetch runs it despite a CORS origin allowlist', async () => {
      const calls: unknown[] = []
      const handler = new RPCHandler(createRouter(calls), {
        plugins: [new CORSHandlerPlugin({ origin: ['https://app.example.com'], credentials: true })],
      })
      const { response } = await run(handler, await crossSiteMultipartPost({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' }))
      expect(response?.status).toBe(200)
      expect(calls).toHaveLength(1)
    })
  })

  describe('with the CSRF protection plugin', () => {
    function createHandler(calls: unknown[], extraPlugins: any[] = []) {
      return new RPCHandler(createRouter(calls), {
        allowMethods: ['GET', ...RPC_DEFAULT_ALLOW_METHODS],
        plugins: [
          new CsrfProtectionHandlerPlugin({ trustedOrigins: ['https://frontend.example'] }),
          new GetMethodCsrfProtectionHandlerPlugin(),
          ...extraPlugins,
        ],
      })
    }

    async function expectForbidden(response: Response | undefined) {
      expect(response?.status).toBe(403)
      await expect(response!.json()).resolves.toMatchObject({
        json: expect.objectContaining({ code: 'FORBIDDEN' }),
      })
    }

    it('blocks a cross-site form POST', async () => {
      const calls: unknown[] = []
      const { matched, response } = await run(createHandler(calls), await crossSiteMultipartPost())

      expect(matched).toBe(true)
      await expectForbidden(response)
      expect(calls).toEqual([])
    })

    it('blocks a cross-site no-cors fetch', async () => {
      const calls: unknown[] = []
      const { response } = await run(createHandler(calls), await crossSiteMultipartPost({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' }))

      await expectForbidden(response)
      expect(calls).toEqual([])
    })

    it('blocks a cors-mode fetch from an untrusted origin', async () => {
      const calls: unknown[] = []
      const { response } = await run(createHandler(calls), await crossSiteMultipartPost({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }))

      await expectForbidden(response)
      expect(calls).toEqual([])
    })

    it('allows a cors-mode fetch from a trusted origin', async () => {
      const calls: unknown[] = []
      const { response } = await run(createHandler(calls), await crossSiteMultipartPost({
        'origin': 'https://frontend.example',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      }))

      expect(response?.status).toBe(200)
      expect(calls).toHaveLength(1)
    })

    it('allows a same-origin request', async () => {
      const calls: unknown[] = []
      const { response } = await run(createHandler(calls), await crossSiteMultipartPost({
        'origin': 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      }))

      expect(response?.status).toBe(200)
      expect(calls).toHaveLength(1)
    })

    it('allows a non-browser client sending neither origin nor fetch metadata', async () => {
      const calls: unknown[] = []
      const request = await crossSiteMultipartPost()
      request.headers.delete('origin')
      request.headers.delete('sec-fetch-site')
      request.headers.delete('sec-fetch-mode')
      request.headers.delete('sec-fetch-dest')

      const { response } = await run(createHandler(calls), request)

      expect(response?.status).toBe(200)
      expect(calls).toHaveLength(1)
    })

    it('leaves a request matching no procedure unmatched', async () => {
      const { matched, response } = await run(createHandler([]), new Request('https://app.example.com/rpc/unknown', {
        method: 'POST',
        headers: CROSS_SITE,
      }))

      expect(matched).toBe(false)
      expect(response).toBeUndefined()
    })

    describe('batch sub-requests', () => {
      function createBatchRequest(transportHeaders: Record<string, string>) {
        return new Request('https://app.example.com/rpc/__batch__', {
          method: 'POST',
          headers: {
            'orpc-batch': 'buffered',
            'content-type': 'application/json',
            'cookie': 'session=victim',
            ...transportHeaders,
          },
          body: JSON.stringify([{
            kind: 'request',
            id: 0,
            json: {
              method: 'POST',
              url: '/rpc/transfer',
              // the client picks these, so they must not be able to overturn the verdict
              headers: { 'sec-fetch-site': 'same-origin', 'origin': 'https://frontend.example' },
              body: { json: { to: 'attacker', amount: 1000 } },
            },
            binary: undefined,
          }]),
        })
      }

      it('judges sub-requests by the transport headers, which override the client-authored ones', async () => {
        const calls: unknown[] = []
        const { response } = await run(
          createHandler(calls, [new BatchHandlerPlugin()]),
          createBatchRequest({ 'sec-fetch-site': 'cross-site', 'origin': 'https://evil.example' }),
        )

        const body = await response!.json() as any
        expect(body[0]).toMatchObject({ kind: 'response', id: 0 })
        expect(body[0].json.status).toBe(403)
        expect(calls).toEqual([])
      })

      it('allows sub-requests of a same-origin batch', async () => {
        const calls: unknown[] = []
        const { response } = await run(
          createHandler(calls, [new BatchHandlerPlugin()]),
          createBatchRequest({ 'sec-fetch-site': 'same-origin', 'origin': 'https://app.example.com' }),
        )

        const body = await response!.json() as any
        expect(body[0]).toMatchObject({ kind: 'response', id: 0, json: { body: { json: { ok: true } } } })
        expect(calls).toEqual([{ input: { to: 'attacker', amount: 1000 }, user: 'victim' }])
      })
    })
  })
})
