import type { RPCHandlerOptions } from './rpc-handler'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { BatchLinkPlugin } from '@orpc/client/plugins'
import { os } from '../../builder'
import { BatchHandlerPlugin, MethodOverrideHandlerPlugin } from '../../plugins'
import { RPCHandler } from './rpc-handler'

/** Fetch Metadata of a form a page on another site submits, attaching the user's cookies. */
const CROSS_SITE_FORM = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }
/** Fetch Metadata of a `fetch(url, { mode: 'no-cors', credentials: 'include' })` from another site. */
const CROSS_SITE_NO_CORS_FETCH = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' }
/** Fetch Metadata of a cross-origin `fetch` that passed a CORS preflight, as RPC Link sends. */
const CROSS_SITE_CORS_FETCH = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }

const ATTACKER_INPUT = { to: 'attacker', amount: 1000 }

describe('rpcHandler csrf protection', () => {
  const transfer = vi.fn((input: unknown) => ({ received: input }))

  const router = {
    transfer: os.handler(({ input }) => transfer(input)),
  }

  function createHandler(options: RPCHandlerOptions<any> = {}) {
    return new RPCHandler(router, options)
  }

  function createRequest(init: RequestInit, url = 'https://bank.example.com/transfer') {
    return new Request(url, { method: 'POST', ...init })
  }

  function createMultipartForm() {
    const form = new FormData()
    form.set('data', JSON.stringify({ json: ATTACKER_INPUT }))
    return form
  }

  async function expectBlocked(handler: RPCHandler<any>, request: Request) {
    const { matched, response } = await handler.handle(request)

    expect(matched).toBe(true)
    expect(response!.status).toBe(403)
    await expect(response!.json()).resolves.toMatchObject({
      json: { code: 'FORBIDDEN', message: expect.stringContaining('CSRF protection') },
    })
    expect(transfer).not.toHaveBeenCalled()
    // rejected before the body is parsed
    expect(request.bodyUsed).toBe(false)
  }

  async function expectAllowed(handler: RPCHandler<any>, request: Request) {
    const { matched, response } = await handler.handle(request)

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    expect(transfer).toHaveBeenCalledOnce()

    return transfer.mock.calls[0]![0]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('requests a page on another site can send without a CORS preflight', () => {
    it.each([
      ['a multipart form whose data field holds RPC JSON', () => ({
        headers: CROSS_SITE_FORM,
        body: createMultipartForm(),
      })],
      ['an urlencoded form', () => ({
        headers: { ...CROSS_SITE_FORM, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: JSON.stringify({ json: ATTACKER_INPUT }) }),
      })],
      ['a text/plain form', () => ({
        headers: { ...CROSS_SITE_FORM, 'content-type': 'text/plain' },
        body: `data=${JSON.stringify({ json: ATTACKER_INPUT })}\r\n`,
      })],
      ['a text/plain form with parameters and odd casing', () => ({
        headers: { ...CROSS_SITE_FORM, 'content-type': ' Text/Plain ; charset=UTF-8' },
        body: JSON.stringify({ json: ATTACKER_INPUT }),
      })],
      ['a no-cors fetch without a body', () => ({
        headers: CROSS_SITE_NO_CORS_FETCH,
      })],
      ['a no-cors fetch with an untyped Blob body, which sends no Content-Type', () => ({
        headers: CROSS_SITE_NO_CORS_FETCH,
        body: new Blob([JSON.stringify({ json: ATTACKER_INPUT })]),
      })],
      ['a multipart form from a sibling subdomain', () => ({
        headers: { ...CROSS_SITE_FORM, 'sec-fetch-site': 'same-site' },
        body: createMultipartForm(),
      })],
      ['a multipart form from a browser that sends no Fetch Metadata, such as over plain HTTP', () => ({
        body: createMultipartForm(),
      })],
    ])('rejects %s', async (_, init) => {
      await expectBlocked(createHandler(), createRequest(init()))
    })

    it.each(['PUT', 'PATCH', 'DELETE'])('rejects a form overridden to %s by the method override plugin', async (method) => {
      const handler = createHandler({ plugins: [new MethodOverrideHandlerPlugin()] })

      await expectBlocked(handler, createRequest({
        headers: CROSS_SITE_FORM,
        body: createMultipartForm(),
      }, `https://bank.example.com/transfer?method=${method}`))
    })

    it('reaches the procedure with attacker-controlled input once the protection is disabled', async () => {
      const handler = createHandler({ csrfProtection: false })

      const input = await expectAllowed(handler, createRequest({
        headers: CROSS_SITE_FORM,
        body: createMultipartForm(),
      }))

      expect(input).toEqual(ATTACKER_INPUT)
    })
  })

  describe('requests that a browser preflights or reports as same-origin', () => {
    it('allows a JSON request, which browsers only send cross-origin after a preflight', async () => {
      const input = await expectAllowed(createHandler(), createRequest({
        headers: { ...CROSS_SITE_CORS_FETCH, 'content-type': 'application/json' },
        body: JSON.stringify({ json: { to: 'friend' } }),
      }))

      expect(input).toEqual({ to: 'friend' })
    })

    it('allows a form-encoded request carrying the orpc-protocol header, such as one from a custom client', async () => {
      const input = await expectAllowed(createHandler(), createRequest({
        headers: { ...CROSS_SITE_CORS_FETCH, 'orpc-protocol': 'rpc' },
        body: createMultipartForm(),
      }))

      expect(input).toEqual(ATTACKER_INPUT)
    })

    it('allows a same-origin multipart form, so progressive enhancement keeps working', async () => {
      const input = await expectAllowed(createHandler(), createRequest({
        headers: { ...CROSS_SITE_FORM, 'sec-fetch-site': 'Same-Origin' },
        body: createMultipartForm(),
      }))

      expect(input).toEqual(ATTACKER_INPUT)
    })

    it('allows a same-origin form overridden to DELETE by the method override plugin', async () => {
      const handler = createHandler({ plugins: [new MethodOverrideHandlerPlugin()] })

      await expectAllowed(handler, createRequest({
        headers: { ...CROSS_SITE_FORM, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }, 'https://bank.example.com/transfer?method=DELETE'))
    })

    it('does not trust a repeated sec-fetch-site header', async () => {
      const request = createRequest({ body: createMultipartForm() })
      request.headers.append('sec-fetch-site', 'same-origin')
      request.headers.append('sec-fetch-site', 'same-origin')

      await expectBlocked(createHandler(), request)
    })

    it('leaves GET requests, whose input is in the URL, to the GET method CSRF protection plugin', async () => {
      const handler = createHandler({ allowMethods: ['GET'] })
      const data = encodeURIComponent(JSON.stringify({ json: { to: 'friend' } }))

      await expectAllowed(handler, new Request(`https://bank.example.com/transfer?data=${data}`, {
        headers: CROSS_SITE_NO_CORS_FETCH,
      }))
    })
  })

  describe('csrfProtection as a function', () => {
    it('is only called for requests the protection would reject, with the request, procedure, and path', async () => {
      const csrfProtection = vi.fn(() => true)
      const handler = createHandler({ csrfProtection })

      await expectAllowed(handler, createRequest({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }))
      expect(csrfProtection).not.toHaveBeenCalled()

      transfer.mockClear()
      await expectBlocked(handler, createRequest({ headers: CROSS_SITE_FORM, body: createMultipartForm() }))
      expect(csrfProtection).toHaveBeenCalledOnce()
      expect(csrfProtection).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', url: '/transfer' }),
        router.transfer,
        ['transfer'],
      )
    })

    it('lets a request through when it returns false', async () => {
      const handler = createHandler({ csrfProtection: () => false })

      const input = await expectAllowed(handler, createRequest({ headers: CROSS_SITE_FORM, body: createMultipartForm() }))

      expect(input).toEqual(ATTACKER_INPUT)
    })
  })

  describe('with RPC Link', () => {
    const handler = createHandler({ plugins: [new BatchHandlerPlugin()] })

    function createClient(options: Partial<ConstructorParameters<typeof RPCLink>[0]> = {}) {
      return createORPCClient<any>(new RPCLink({
        origin: 'https://bank.example.com',
        // RPC Link calling from another origin, after the browser's CORS preflight
        fetch: async (url, init) => {
          const headers = new Headers(init.headers)

          for (const [key, value] of Object.entries(CROSS_SITE_CORS_FETCH)) {
            headers.set(key, value)
          }

          const { response } = await handler.handle(new Request(url, { ...init, headers }))
          return response ?? new Response('Not Found', { status: 404 })
        },
        ...options,
      }))
    }

    it.each([
      ['JSON input', { to: 'friend' }],
      ['no input, sent without a body', undefined],
      ['a nested file, sent as multipart', { note: new File(['hello'], 'note.txt', { type: 'text/plain' }) }],
      ['a root-level text file', new File(['hello'], 'note.txt', { type: 'text/plain' })],
    ])('calls procedures with %s', async (_, input) => {
      const client = createClient()

      await expect(client.transfer(input)).resolves.toEqual({ received: input })
      expect(transfer).toHaveBeenCalledOnce()
    })

    it('calls procedures with a root-level untyped Blob, sent with an empty Content-Type', async () => {
      const client = createClient()

      await client.transfer(new Blob(['hello']))

      expect(transfer).toHaveBeenCalledOnce()
      expect(transfer).toHaveBeenCalledWith(expect.any(Blob))
    })

    it('calls procedures with no input through the batch plugin', async () => {
      const client = createClient({
        plugins: [new BatchLinkPlugin({ groups: [{ condition: () => true, context: {} }] })],
      })

      await expect(Promise.all([
        client.transfer(undefined),
        client.transfer({ note: new File(['hello'], 'note.txt', { type: 'text/plain' }) }),
      ])).resolves.toHaveLength(2)
      expect(transfer).toHaveBeenCalledTimes(2)
    })
  })
})
