import type { StandardResponse } from '@standard-server/core'
import { AsyncIteratorClass } from '@orpc/shared'
import supertest from 'supertest'
import { RPCHandler } from '../adapters/fetch'
import { RPCHandler as NodeRPCHandler } from '../adapters/node'
import { os } from '../builder'
import { HeadMethodHandlerPlugin } from './head-method'
import { ResponseCompressionHandlerPlugin } from './response-compression'

function getInterceptors() {
  const existingInterceptor = vi.fn()

  const { routingInterceptors } = new HeadMethodHandlerPlugin<any>().init({
    routingInterceptors: [existingInterceptor],
  })

  return {
    bodylessInterceptor: routingInterceptors![0]!,
    existingInterceptor,
    fallbackInterceptor: routingInterceptors![2]!,
    routingInterceptors: routingInterceptors!,
  }
}

async function dropBody(response: StandardResponse, method = 'HEAD') {
  const { bodylessInterceptor } = getInterceptors()

  const result = await bodylessInterceptor({
    context: {},
    request: { method, url: '/' },
    next: async () => ({ matched: true, response }),
  } as any)

  return result.response!
}

async function readStandardBody(body: unknown) {
  expect(body).toBeInstanceOf(ReadableStream)
  return new Response(body as ReadableStream).text()
}

describe('headMethodHandlerPlugin', () => {
  it('drops the body outermost and falls back to GET innermost', () => {
    const { routingInterceptors, existingInterceptor } = getInterceptors()

    expect(routingInterceptors).toHaveLength(3)
    expect(routingInterceptors[1]).toBe(existingInterceptor)
  })

  describe('fallback', () => {
    async function invoke(method: string, results: unknown[]) {
      const { fallbackInterceptor } = getInterceptors()
      const next = vi.fn()
      results.forEach(result => next.mockResolvedValueOnce(result))

      const request = { method, url: '/planets?id=1', headers: { accept: 'application/json' } }
      const result = await fallbackInterceptor({ context: { user: 'u' }, prefix: '/api', request, next } as any)

      return { result, next }
    }

    it('keeps a matched HEAD request', async () => {
      const matched = { matched: true, response: { status: 200, headers: {}, body: undefined } }
      const { result, next } = await invoke('HEAD', [matched])

      expect(next).toHaveBeenCalledExactlyOnceWith()
      expect(result).toBe(matched)
    })

    it('retries an unmatched HEAD request as GET', async () => {
      const matched = { matched: true, response: { status: 200, headers: {}, body: undefined } }
      const { result, next } = await invoke('HEAD', [{ matched: false }, matched])

      expect(next).toHaveBeenCalledTimes(2)
      expect(next).toHaveBeenNthCalledWith(1)
      expect(next).toHaveBeenNthCalledWith(2, {
        context: { user: 'u' },
        prefix: '/api',
        request: { method: 'GET', url: '/planets?id=1', headers: { accept: 'application/json' } },
      })
      expect(result).toBe(matched)
    })

    it('stays unmatched when no GET procedure matches either', async () => {
      const { result, next } = await invoke('HEAD', [{ matched: false }, { matched: false }])

      expect(next).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ matched: false })
    })

    it.each(['GET', 'POST', 'OPTIONS'])('does not retry an unmatched %s request', async (method) => {
      const { result, next } = await invoke(method, [{ matched: false }])

      expect(next).toHaveBeenCalledExactlyOnceWith()
      expect(result).toEqual({ matched: false })
    })
  })

  describe('bodyless response', () => {
    it.each(['GET', 'POST'])('keeps the body of a %s response', async (method) => {
      const response = { status: 200, headers: {}, body: { value: 1 } }

      expect(await dropBody(response, method)).toBe(response)
    })

    it('keeps an unmatched result', async () => {
      const { bodylessInterceptor } = getInterceptors()

      const result = await bodylessInterceptor({
        context: {},
        request: { method: 'HEAD', url: '/' },
        next: async () => ({ matched: false }),
      } as any)

      expect(result).toEqual({ matched: false })
    })

    it('keeps a response without a body', async () => {
      const response = { status: 204, headers: { etag: '"1"' }, body: undefined }

      expect(await dropBody(response)).toBe(response)
    })

    it('reports the byte length of a JSON body and keeps status and headers', async () => {
      const response = await dropBody({
        status: 201,
        headers: { 'x-custom': 'value', 'content-length': '999' },
        body: { name: 'héllo' },
      })

      expect(response.status).toBe(201)
      expect(response.headers).toEqual({
        'x-custom': 'value',
        'standard-server': [],
        'content-type': 'application/json',
        'content-length': '17',
      })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })

    it('reports the size, type, and filename of a file body', async () => {
      const response = await dropBody({
        status: 200,
        headers: {},
        body: new File(['hello'], 'hello.txt', { type: 'text/plain' }),
      })

      expect(response.headers).toEqual({
        'standard-server': 'file',
        'content-type': 'text/plain',
        'content-disposition': 'inline; filename="hello.txt"; filename*=utf-8\'\'hello.txt',
        'content-length': '5',
      })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })

    it('keeps the explicit headers of a blob body', async () => {
      const response = await dropBody({
        status: 200,
        headers: { 'content-type': 'image/png', 'content-disposition': 'attachment' },
        body: new Blob(['hello'], { type: 'text/plain' }),
      })

      expect(response.headers).toEqual({
        'standard-server': 'file',
        'content-type': 'image/png',
        'content-disposition': 'attachment',
        'content-length': '5',
      })
    })

    it('cancels a stream body and keeps its headers', async () => {
      const cancel = vi.fn()
      const response = await dropBody({
        status: 200,
        headers: { 'content-type': 'video/mp4' },
        body: new ReadableStream({ cancel }),
      })

      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
      expect(response.headers).toEqual({ 'content-type': 'video/mp4' })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })

    it('closes an event stream body without a content length', async () => {
      const cleanup = vi.fn()
      const response = await dropBody({
        status: 200,
        headers: { 'content-length': '10' },
        body: new AsyncIteratorClass(async () => ({ done: false, value: 1 }), cleanup),
      })

      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
      expect(response.headers).toEqual({
        'standard-server': [],
        'content-type': 'text/event-stream',
        'content-length': undefined,
      })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })

    it('reports the multipart content type of a form data body', async () => {
      const form = new FormData()
      form.append('name', 'value')

      const response = await dropBody({ status: 200, headers: {}, body: form })

      expect(response.headers).toEqual({
        'standard-server': [],
        'content-type': expect.stringMatching(/^multipart\/form-data; boundary=/),
        'content-length': undefined,
      })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })

    it('reports the length of a URL-encoded body', async () => {
      const response = await dropBody({ status: 200, headers: {}, body: new URLSearchParams({ name: 'hé llo' }) })

      expect(response.headers).toEqual({
        'standard-server': [],
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '16',
      })
      await expect(readStandardBody(response.body)).resolves.toBe('')
    })
  })

  describe('with fetch handler', () => {
    const ping = vi.fn(() => ({ message: 'pong' }))

    const handler = new RPCHandler({ ping: os.handler(ping) }, {
      allowMethods: ['GET'],
      plugins: [new HeadMethodHandlerPlugin()],
    })

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('answers HEAD with the GET procedure and the GET headers', async () => {
      const get = await handler.handle(new Request('https://example.com/ping'))
      const getBody = await get.response!.text()

      const { matched, response } = await handler.handle(new Request('https://example.com/ping', { method: 'HEAD' }))

      expect(matched).toBe(true)
      expect(ping).toHaveBeenCalledTimes(2)
      expect(response!.status).toBe(200)
      expect(response!.headers.get('content-type')).toBe('application/json')
      expect(response!.headers.get('content-length')).toBe(`${getBody.length}`)
      expect(response!.headers.has('standard-server')).toBe(false)
      await expect(response!.text()).resolves.toBe('')
    })

    it('keeps HEAD unmatched when GET is not allowed', async () => {
      const handler = new RPCHandler({ ping: os.handler(ping) }, {
        plugins: [new HeadMethodHandlerPlugin()],
      })

      await expect(handler.handle(new Request('https://example.com/ping', { method: 'HEAD' })))
        .resolves
        .toEqual({ matched: false })
      expect(ping).not.toHaveBeenCalled()
    })

    it('drops the body of an error response', async () => {
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

    it.each([
      ['before', (head: any, compression: any) => [head, compression]],
      ['after', (head: any, compression: any) => [compression, head]],
    ])('reports the compressed encoding when listed %s the compression plugin', async (_, order) => {
      const handler = new RPCHandler({ ping: os.handler(() => 'x'.repeat(2000)) }, {
        allowMethods: ['GET'],
        plugins: order(new HeadMethodHandlerPlugin(), new ResponseCompressionHandlerPlugin()),
      })

      const { response } = await handler.handle(new Request('https://example.com/ping', {
        method: 'HEAD',
        headers: { 'accept-encoding': 'gzip' },
      }))

      expect(response!.status).toBe(200)
      expect(response!.headers.get('content-encoding')).toBe('gzip')
      expect(response!.headers.has('content-length')).toBe(false)
      await expect(response!.text()).resolves.toBe('')
    })
  })

  describe('with node handler', () => {
    it('sends the GET headers without a body', async () => {
      const handler = new NodeRPCHandler({ ping: os.handler(() => ({ message: 'pong' })) }, {
        allowMethods: ['GET'],
        plugins: [new HeadMethodHandlerPlugin()],
      })

      const agent = supertest(async (req: any, res: any) => {
        const { matched } = await handler.handle(req, res)

        if (!matched) {
          res.statusCode = 404
          res.end('not matched')
        }
      })

      const get = await agent.get('/ping')
      const head = await agent.head('/ping')

      expect(head.status).toBe(200)
      expect(head.headers['content-type']).toBe('application/json')
      expect(head.headers['content-length']).toBe(`${get.text.length}`)
      expect(head.text).toBeUndefined()
    })
  })
})
