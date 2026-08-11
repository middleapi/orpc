import type { SimpleCsrfProtectionHandlerPluginOptions } from './simple-csrf-protection'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { RPC_DEFAULT_ALLOW_METHODS } from '../adapters/standard'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { SimpleCsrfProtectionHandlerPlugin } from './simple-csrf-protection'

const BLOCKED_RESPONSE = {
  status: 403,
  headers: {},
  body: 'Request blocked by CSRF protection.',
}

function makeRequest(headers: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    url: '/ping',
    headers,
    signal: new AbortController().signal,
  } as any
}

function getPlugin(options: SimpleCsrfProtectionHandlerPluginOptions<any> = {}) {
  const existingRoutingInterceptor = vi.fn()

  const handlerOptions = new SimpleCsrfProtectionHandlerPlugin<any>(options).init({
    routingInterceptors: [existingRoutingInterceptor],
  } as any)

  return {
    routingInterceptor: handlerOptions.routingInterceptors![0]!,
    existingRoutingInterceptor,
    handlerOptions,
  }
}

function invokeInterceptor(
  headers: Record<string, unknown>,
  options: SimpleCsrfProtectionHandlerPluginOptions<any> = {},
) {
  const nextResult = { matched: true, response: 'ok' as const }
  const next = vi.fn().mockResolvedValue(nextResult)
  const { routingInterceptor } = getPlugin(options)

  const interceptorOptions = { context: {}, request: makeRequest(headers), next } as any

  return { result: routingInterceptor(interceptorOptions), next, nextResult, interceptorOptions }
}

async function expectAllowed(
  headers: Record<string, unknown>,
  options: SimpleCsrfProtectionHandlerPluginOptions<any> = {},
) {
  const { result, next, nextResult } = invokeInterceptor(headers, options)

  await expect(result).resolves.toBe(nextResult)
  expect(next).toHaveBeenCalledOnce()
}

async function expectBlocked(
  headers: Record<string, unknown>,
  options: SimpleCsrfProtectionHandlerPluginOptions<any> = {},
) {
  const { result, next } = invokeInterceptor(headers, options)

  await expect(result).resolves.toEqual({ matched: true, response: BLOCKED_RESPONSE })
  expect(next).not.toHaveBeenCalled()
}

describe('simpleCsrfProtectionHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registration', () => {
    it('prepends its routing interceptor so it runs before existing ones', () => {
      const { handlerOptions, existingRoutingInterceptor } = getPlugin()

      expect(handlerOptions.routingInterceptors).toHaveLength(2)
      expect(handlerOptions.routingInterceptors![1]).toBe(existingRoutingInterceptor)
    })

    it('runs after the batch plugin so it judges the original request', () => {
      expect(new SimpleCsrfProtectionHandlerPlugin().after).toContain('~batch')
    })
  })

  describe('requests without fetch metadata', () => {
    it('passes through when the request has no sec-fetch-* headers', async () => {
      await expectAllowed({})
    })

    it('passes through when only sec-fetch-mode is present', async () => {
      await expectAllowed({ 'sec-fetch-mode': 'cors' })
    })

    it('still enforces sec-fetch-site when sec-fetch-mode is absent', async () => {
      await expectAllowed({ 'sec-fetch-site': 'same-origin' })
      await expectBlocked({ 'sec-fetch-site': 'cross-site' })
    })
  })

  describe('fetch mode', () => {
    it.each([
      'cors',
      'same-origin',
      'navigate',
      'no-cors',
      'websocket',
    ])('allows every mode from a trusted site by default, including %s', async (mode) => {
      await expectAllowed({ 'sec-fetch-mode': mode, 'sec-fetch-site': 'same-origin' })
    })

    it.each([
      'cors',
      'navigate',
      'no-cors',
      'websocket',
    ])('still blocks mode %s when the site is not trusted', async (mode) => {
      await expectBlocked({ 'sec-fetch-mode': mode, 'sec-fetch-site': 'cross-site' })
    })
  })

  describe('allowModes', () => {
    const scripted = { allowModes: ['cors', 'same-origin'] }

    it.each([
      'cors',
      'same-origin',
      'CORS',
    ])('passes through an allowed mode: %s', async (mode) => {
      await expectAllowed({ 'sec-fetch-mode': mode, 'sec-fetch-site': 'same-origin' }, scripted)
    })

    it.each([
      'navigate',
      'no-cors',
      'websocket',
    ])('blocks a disallowed mode even from a trusted site: %s', async (mode) => {
      await expectBlocked({ 'sec-fetch-mode': mode, 'sec-fetch-site': 'same-origin' }, scripted)
    })

    it('matches configured modes case-insensitively', async () => {
      await expectAllowed({ 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' }, {
        allowModes: ['NAVIGATE'],
      })
    })

    it('does not reject a request that carries no sec-fetch-mode header', async () => {
      await expectAllowed({ 'sec-fetch-site': 'same-origin' }, scripted)
    })

    it('blocks when sec-fetch-mode is repeated', async () => {
      await expectBlocked({ 'sec-fetch-mode': ['cors', 'cors'], 'sec-fetch-site': 'same-origin' }, scripted)
    })

    it('blocks every mode when the allowlist is empty', async () => {
      await expectBlocked({ 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' }, { allowModes: [] })
    })
  })

  describe('fetch site', () => {
    it.each([
      'same-origin',
      'SAME-ORIGIN',
    ])('passes through when sec-fetch-site is %s', async (site) => {
      await expectAllowed({ 'sec-fetch-mode': 'cors', 'sec-fetch-site': site })
    })

    it('blocks same-site requests by default', async () => {
      await expectBlocked({
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'origin': 'https://docs.example.com',
      })
    })

    it('passes through same-site requests when allowSameSite is true', async () => {
      await expectAllowed({
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'origin': 'https://docs.example.com',
      }, { allowSameSite: true })
    })

    it('allows a trusted same-site origin without opening up the whole site', async () => {
      const options = { origin: 'https://docs.example.com' }

      await expectAllowed({
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'origin': 'https://docs.example.com',
      }, options)

      await expectBlocked({
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'origin': 'https://blog.example.com',
      }, options)
    })

    it('blocks a cross-site fetch, which reaches the server even when CORS hides the response', async () => {
      await expectBlocked({
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'origin': 'https://evil.com',
      })
    })

    it('blocks a cross-site request that sends no origin header, such as an <img> tag', async () => {
      await expectBlocked({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'cross-site' })
    })

    it('blocks browser-initiated requests (sec-fetch-site: none)', async () => {
      await expectBlocked({ 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' })
    })

    it('blocks unrecognized sec-fetch-site values', async () => {
      await expectBlocked({ 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'future-value' })
    })
  })

  describe('cross-site origin allowlist', () => {
    const crossSiteHeaders = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
      'origin': 'https://app.example.com',
    }

    it('allows an origin listed as a string', async () => {
      await expectAllowed(crossSiteHeaders, { origin: 'https://app.example.com' })
    })

    it('allows an origin listed in an array', async () => {
      await expectAllowed(crossSiteHeaders, {
        origin: ['https://other.example.com', 'https://app.example.com'],
      })
    })

    it('treats * as a literal origin rather than a wildcard', async () => {
      await expectBlocked(crossSiteHeaders, { origin: '*' })
    })

    it.each([
      ['a cross-site <img> tag', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }],
      ['a link opened from outside the browser', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }],
    ])('can never admit %s, which sends no origin header', async (_, headers) => {
      await expectBlocked(headers)
      await expectBlocked(headers, { origin: ['https://app.example.com'] })
      await expectBlocked(headers, { origin: '*' })
    })

    it('blocks an origin that is not listed', async () => {
      await expectBlocked(crossSiteHeaders, { origin: ['https://other.example.com'] })
    })

    it.each([
      null,
      undefined,
      [],
    ])('blocks when the allowlist resolves to %s', async (origin) => {
      await expectBlocked(crossSiteHeaders, { origin })
    })

    it('resolves the allowlist from a function receiving the origin and routing options', async () => {
      const origin = vi.fn((origin: string) => [origin])
      const { result, next, nextResult, interceptorOptions } = invokeInterceptor(crossSiteHeaders, { origin })

      await expect(result).resolves.toBe(nextResult)
      expect(next).toHaveBeenCalledOnce()
      expect(origin).toHaveBeenCalledOnce()
      expect(origin).toHaveBeenCalledWith('https://app.example.com', interceptorOptions)
    })

    it('is not consulted when the request sends no origin header', async () => {
      const origin = vi.fn(() => ['https://app.example.com'])
      const { result, next } = invokeInterceptor({ 'sec-fetch-site': 'cross-site' }, { origin })

      await expect(result).resolves.toEqual({ matched: true, response: BLOCKED_RESPONSE })
      expect(next).not.toHaveBeenCalled()
      expect(origin).not.toHaveBeenCalled()
    })

    it('is not consulted for same-origin requests', async () => {
      const origin = vi.fn(() => [])

      await expectAllowed({ 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' }, { origin })

      expect(origin).not.toHaveBeenCalled()
    })
  })

  describe('with a GET-enabled RPCHandler', () => {
    const deletePlanet = vi.fn(() => 'deleted')

    function createHandler(options: SimpleCsrfProtectionHandlerPluginOptions<any> = {}, extraPlugins: any[] = []) {
      return new RPCHandler({ deletePlanet: os.handler(deletePlanet) }, {
        allowMethods: ['GET', ...RPC_DEFAULT_ALLOW_METHODS],
        plugins: [new SimpleCsrfProtectionHandlerPlugin(options), ...extraPlugins],
      })
    }

    function createGetRequest(headers: Record<string, string>) {
      return new Request('https://api.example.com/deletePlanet', { headers })
    }

    it.each([
      ['a cross-site link or redirect', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }],
      ['a cross-site <img> tag', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }],
      ['a cross-site fetch, which CORS lets through', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'origin': 'https://evil.com' }],
      ['a cross-site form submission', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'origin': 'https://evil.com' }],
      ['a link opened from outside the browser, such as an email', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }],
      ['a sibling subdomain serving user content', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }],
    ])('blocks %s', async (_, headers) => {
      const { matched, response } = await createHandler().handle(createGetRequest(headers))

      expect(matched).toBe(true)
      expect(response!.status).toBe(403)
      expect(deletePlanet).not.toHaveBeenCalled()
    })

    it.each([
      ['a same-origin fetch', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }],
      ['a same-origin form submission', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'origin': 'https://api.example.com' }],
      ['a non-browser client', {}],
    ])('allows %s', async (_, headers) => {
      const { response } = await createHandler().handle(createGetRequest(headers))

      expect(response!.status).toBe(200)
      expect(deletePlanet).toHaveBeenCalledOnce()
    })

    it('blocks a same-origin <img> tag pointing at a smuggled url once allowModes is narrowed', async () => {
      const handler = createHandler({ allowModes: ['cors', 'same-origin'] })

      const { response } = await handler.handle(createGetRequest({
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-dest': 'image',
      }))

      expect(response!.status).toBe(403)
      expect(deletePlanet).not.toHaveBeenCalled()
    })

    it('rejects before routing, so a request matching no procedure never reaches the router', async () => {
      const { matched, response } = await createHandler().handle(
        new Request('https://api.example.com/unknown', {
          headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'origin': 'https://evil.com' },
        }),
      )

      expect(matched).toBe(true)
      expect(response!.status).toBe(403)
    })

    describe('batch sub-requests', () => {
      function createBatchAttack(handler: RPCHandler<any>) {
        const data = encodeURIComponent(JSON.stringify([{
          kind: 'request',
          id: 0,
          json: {
            method: 'GET',
            url: '/deletePlanet',
            // the client picks these, so they must not be able to overturn the verdict
            headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
          },
          binary: undefined,
        }]))

        return handler.handle(new Request(`https://api.example.com/__batch__?data=${data}`, {
          headers: {
            'orpc-batch': 'buffered',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'cors',
            'origin': 'https://evil.com',
          },
        }))
      }

      it('blocks the whole batch before it is split into sub-requests', async () => {
        const { response } = await createBatchAttack(createHandler({}, [new BatchHandlerPlugin()]))

        expect(response!.status).toBe(403)
        expect(deletePlanet).not.toHaveBeenCalled()
      })

      it('blocks it even when mapSubrequest forwards the spoofed headers verbatim', async () => {
        const batch = new BatchHandlerPlugin({ mapSubrequest: subRequest => subRequest })
        const { response } = await createBatchAttack(createHandler({}, [batch]))

        expect(response!.status).toBe(403)
        expect(deletePlanet).not.toHaveBeenCalled()
      })
    })
  })
})
