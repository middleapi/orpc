import type { StandardResponse } from '@standard-server/core'
import { toFetchResponse } from '@standard-server/fetch'
import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { os } from '../builder'
import { GetMethodCsrfProtectionHandlerPlugin } from './get-method-csrf-protection'
import { HeadMethodHandlerPlugin } from './head-method'
import { ResponseCompressionHandlerPlugin } from './response-compression'

function getInterceptors() {
  const existingInterceptor = vi.fn()

  const handlerOptions = new HeadMethodHandlerPlugin<any>().init({
    routingInterceptors: [existingInterceptor],
  } as any)

  const routingInterceptors = handlerOptions.routingInterceptors!

  return {
    bodyInterceptor: routingInterceptors[0]!,
    fallbackInterceptor: routingInterceptors.at(-1)!,
    existingInterceptor,
    routingInterceptors,
  }
}

async function toHeadResponse(response: StandardResponse): Promise<StandardResponse> {
  const { bodyInterceptor } = getInterceptors()

  const result = await bodyInterceptor({
    context: {},
    request: { method: 'HEAD', url: '/', headers: {} },
    next: async () => ({ matched: true, response }),
  } as any)

  return result.response!
}

/**
 * The headers an adapter sends for the response, besides those the runtime adds while sending it.
 */
function getSentHeaders(response: StandardResponse): Record<string, string> {
  return Object.fromEntries(toFetchResponse(response).headers)
}

async function expectHeadersOfGet(
  createResponse: () => StandardResponse,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  const reference = createResponse()
  const response = await toHeadResponse(createResponse())
  const headers = getSentHeaders(response)

  expect(response.status).toBe(reference.status)
  expect(headers).toEqual({ ...getSentHeaders(reference), ...extraHeaders })
  await expect(toFetchResponse(response).text()).resolves.toBe('')

  return headers
}

describe('headMethodHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps existing routing interceptors', () => {
    const { routingInterceptors, existingInterceptor } = getInterceptors()

    expect(routingInterceptors).toHaveLength(3)
    expect(routingInterceptors[1]).toBe(existingInterceptor)
  })

  describe('routing', () => {
    it.each(['GET', 'POST'])('ignores %s requests', async (method) => {
      const { bodyInterceptor, fallbackInterceptor } = getInterceptors()
      const nextResult = { matched: true, response: { status: 200, headers: {}, body: { value: 1 } } }

      for (const interceptor of [bodyInterceptor, fallbackInterceptor]) {
        const next = vi.fn().mockResolvedValue(nextResult)

        await expect(interceptor({ context: {}, request: { method, url: '/' }, next } as any)).resolves.toBe(nextResult)
        expect(next).toHaveBeenCalledExactlyOnceWith()
      }
    })

    it('prefers a procedure routed as HEAD', async () => {
      const { fallbackInterceptor } = getInterceptors()
      const nextResult = { matched: true, response: 'head' }
      const next = vi.fn().mockResolvedValue(nextResult)

      await expect(fallbackInterceptor({ context: {}, request: { method: 'HEAD', url: '/' }, next } as any)).resolves.toBe(nextResult)
      expect(next).toHaveBeenCalledExactlyOnceWith()
    })

    it('falls back to GET when no procedure is routed as HEAD', async () => {
      const { fallbackInterceptor } = getInterceptors()
      const nextResult = { matched: true, response: 'get' }
      const next = vi.fn()
        .mockResolvedValueOnce({ matched: false })
        .mockResolvedValueOnce(nextResult)

      const context = { a: 1 }
      const signal = AbortSignal.timeout(1000)
      const request = { method: 'HEAD', url: '/ping?x=1', headers: { 'x-custom': '1' }, signal }

      await expect(fallbackInterceptor({ context, prefix: '/api', request, next } as any)).resolves.toBe(nextResult)
      expect(next).toHaveBeenCalledTimes(2)
      expect(next).toHaveBeenNthCalledWith(1)
      expect(next).toHaveBeenNthCalledWith(2, {
        context,
        prefix: '/api',
        next,
        request: { method: 'GET', url: '/ping?x=1', headers: { 'x-custom': '1' }, signal },
      })
    })

    it('stays unmatched when no procedure is routed as GET either', async () => {
      const { fallbackInterceptor } = getInterceptors()
      const next = vi.fn().mockResolvedValue({ matched: false })

      await expect(fallbackInterceptor({ context: {}, request: { method: 'HEAD', url: '/' }, next } as any)).resolves.toEqual({ matched: false })
      expect(next).toHaveBeenCalledTimes(2)
    })
  })

  describe('response', () => {
    it('leaves unmatched results as is', async () => {
      const { bodyInterceptor } = getInterceptors()
      const nextResult = { matched: false }

      await expect(bodyInterceptor({ context: {}, request: { method: 'HEAD', url: '/' }, next: async () => nextResult } as any)).resolves.toBe(nextResult)
    })

    it('leaves a response without a body as is', async () => {
      const response = { status: 204, headers: { etag: '"1"' }, body: undefined }

      await expect(toHeadResponse(response)).resolves.toBe(response)
    })

    it.each([
      ['json', {}, () => ({ name: 'Ελλάδα' })],
      ['json with a custom content type', { 'content-type': 'application/vnd.api+json' }, () => ({ a: 1 })],
      ['string', {}, () => 'ő'],
      ['null', {}, () => null],
      ['url-search-params', {}, () => new URLSearchParams({ name: 'Ελλάδα' })],
    ])('keeps the headers of a %s body and reports its size', async (_, headers, createBody) => {
      const size = (await toFetchResponse({ status: 200, headers, body: createBody() }).arrayBuffer()).byteLength

      await expectHeadersOfGet(
        () => ({ status: 201, headers: { ...headers, 'x-custom': '1' }, body: createBody() }),
        { 'content-length': size.toString() },
      )
    })

    it('keeps the headers of a file body', async () => {
      const headers = await expectHeadersOfGet(() => ({
        status: 200,
        headers: {},
        body: new File(['hello'], 'hello world.txt', { type: 'text/plain' }),
      }))

      expect(headers).toMatchObject({ 'content-type': 'text/plain', 'content-length': '5' })
    })

    it('keeps the headers of a blob body of unknown size and cancels its stream', async () => {
      const cancel = vi.fn()

      class UnknownSizeBlob extends Blob {
        override get size() {
          return Number.NaN
        }

        override stream() {
          return new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel })
        }
      }

      const headers = await expectHeadersOfGet(() => ({ status: 200, headers: {}, body: new UnknownSizeBlob([], { type: 'text/plain' }) }))

      expect(headers).not.toHaveProperty('content-length')
      expect(cancel).toHaveBeenCalledOnce()
    })

    it('keeps the headers of a stream body and cancels it', async () => {
      const cancel = vi.fn()

      const headers = await expectHeadersOfGet(() => ({
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '100' },
        body: new ReadableStream({ cancel }),
      }))

      expect(headers['content-length']).toBe('100')
      expect(cancel).toHaveBeenCalledOnce()
    })

    it.each([
      [{}],
      [{ 'content-type': 'text/plain' }],
    ])('keeps the headers of an event iterator body with headers %o', async (headers) => {
      await expectHeadersOfGet(() => ({ status: 200, headers, body: (async function* () {})() }))
    })

    it('ends an event iterator body without starting it', async () => {
      let started = false
      const body = (async function* () {
        started = true
        yield 1
      })()

      await toHeadResponse({ status: 200, headers: {}, body })

      await expect(body.next()).resolves.toEqual({ done: true, value: undefined })
      expect(started).toBe(false)
    })

    it('keeps the headers of a form data body', async () => {
      const body = new FormData()
      body.set('file', new File(['hello'], 'hello.txt'))

      const response = await toHeadResponse({ status: 200, headers: { 'x-custom': '1', 'content-length': '1' }, body })

      expect(getSentHeaders(response)).toEqual({
        'x-custom': '1',
        'content-type': expect.stringMatching(/^multipart\/form-data; boundary=/),
      })
      await expect(toFetchResponse(response).text()).resolves.toBe('')
    })
  })

  describe('with handlers', () => {
    const procedure = vi.fn(() => ({ name: 'Ελλάδα' }))
    const router = { ping: os.handler(procedure) }

    it('answers HEAD with the headers of GET', async () => {
      const handler = new RPCHandler(router, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const url = `https://example.com/ping?data=${encodeURIComponent(JSON.stringify({ json: 'input' }))}`
      const { response: getResponse } = await handler.handle(new Request(url))
      const { matched, response } = await handler.handle(new Request(url, { method: 'HEAD' }))

      expect(matched).toBe(true)
      expect(response!.status).toBe(200)
      expect(Object.fromEntries(response!.headers)).toEqual({
        ...Object.fromEntries(getResponse!.headers),
        'content-length': (await getResponse!.arrayBuffer()).byteLength.toString(),
      })
      await expect(response!.text()).resolves.toBe('')
      expect(procedure).toHaveBeenCalledTimes(2)
      expect(procedure).toHaveBeenLastCalledWith(expect.any(Object), 'input')
    })

    it('answers HEAD with the error of GET', async () => {
      const handler = new RPCHandler({
        ping: os.handler(() => {
          throw new Error('boom')
        }),
      }, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const { response } = await handler.handle(new Request('https://example.com/ping', { method: 'HEAD' }))

      expect(response!.status).toBe(500)
      expect(response!.headers.get('content-type')).toBe('application/json')
      expect(Number(response!.headers.get('content-length'))).toBeGreaterThan(0)
      await expect(response!.text()).resolves.toBe('')
    })

    it('routes a procedure allowed for HEAD itself', async () => {
      const methods: string[] = []
      const handler = new RPCHandler(router, {
        allowMethods: ['GET', 'HEAD'],
        interceptors: [({ request, next }) => {
          methods.push(request.method)
          return next()
        }],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const { matched, response } = await handler.handle(new Request('https://example.com/ping', { method: 'HEAD' }))

      expect(matched).toBe(true)
      await expect(response!.text()).resolves.toBe('')
      expect(methods).toEqual(['HEAD'])
    })

    it('stays unmatched when GET is not allowed', async () => {
      const handler = new RPCHandler(router, {
        plugins: [new HeadMethodHandlerPlugin()],
      })

      await expect(handler.handle(new Request('https://example.com/ping', { method: 'HEAD' }))).resolves.toEqual({ matched: false })
      expect(procedure).not.toHaveBeenCalled()
    })

    it('guards HEAD like GET', async () => {
      const handler = new RPCHandler(router, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin(), new GetMethodCsrfProtectionHandlerPlugin()],
      })

      const { response } = await handler.handle(new Request('https://example.com/ping', {
        method: 'HEAD',
        headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
      }))

      expect(response!.status).toBe(403)
      expect(procedure).not.toHaveBeenCalled()
    })

    it('reports the encoding of a compressed GET response', async () => {
      const handler = new RPCHandler({ ping: os.handler(() => 'x'.repeat(2000)) }, {
        allowMethods: ['GET'],
        // listed first to show the order does not matter
        plugins: [new HeadMethodHandlerPlugin(), new ResponseCompressionHandlerPlugin()],
      })

      const init = { headers: { 'accept-encoding': 'gzip' } }
      const { response: getResponse } = await handler.handle(new Request('https://example.com/ping', init))
      const { response } = await handler.handle(new Request('https://example.com/ping', { ...init, method: 'HEAD' }))

      expect(getResponse!.headers.get('content-encoding')).toBe('gzip')
      expect(Object.fromEntries(response!.headers)).toEqual(Object.fromEntries(getResponse!.headers))
      await expect(response!.text()).resolves.toBe('')
    })

    it('ends an event iterator without running it', async () => {
      let started = false
      const handler = new RPCHandler({

        stream: os.handler(async function* () {
          started = true
          await new Promise(() => {})
        }),
      }, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const { response } = await handler.handle(new Request('https://example.com/stream', { method: 'HEAD' }))

      expect(response!.headers.get('content-type')).toBe('text/event-stream')
      await expect(response!.text()).resolves.toBe('')
      expect(started).toBe(false)
    })

    it('sends the size of the GET body with the Node.js adapter', async () => {
      const handler = new NodeRPCHandler(router, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const server = supertest((req: any, res: any) => {
        handler.handle(req, res)
      })

      const getResponse = await server.get('/ping')
      const response = await server.head('/ping')

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json')
      expect(response.headers['content-length']).toBe(getResponse.headers['content-length'])
      expect(response.text).toBeUndefined()
    })
  })
})
