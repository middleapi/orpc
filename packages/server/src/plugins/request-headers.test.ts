import type { RequestHeadersPluginContext } from './request-headers'
import { OpenAPIHandler } from '../../../openapi/src/adapters/fetch/openapi-handler'
import { os } from '../builder'
import { BatchHandlerPlugin } from './batch'
import { RequestHeadersPlugin } from './request-headers'

describe('requestHeadersPlugin', () => {
  it('works', async () => {
    let capturedHeaders: Headers | undefined

    const router = os
      .$context<RequestHeadersPluginContext>()
      .use(({ context, next }) => {
        // Capture the headers from context for verification
        capturedHeaders = context.reqHeaders
        return next()
      })
      .route({
        method: 'GET',
        path: '/ping',
      })
      .handler(() => 'pong')

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new RequestHeadersPlugin(),
      ],
    })

    const request = new Request('https://example.com/ping', {
      headers: {
        'x-custom-1': 'value1',
        'x-custom-2': 'value2',
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
      },
    })

    const { response } = await handler.handle(request)

    if (!response) {
      throw new Error('response is undefined')
    }

    expect(capturedHeaders).toBeInstanceOf(Headers)
    expect(capturedHeaders?.get('x-custom-1')).toBe('value1')
    expect(capturedHeaders?.get('x-custom-2')).toBe('value2')
    expect(capturedHeaders?.get('content-type')).toBe('application/json')
    expect(capturedHeaders?.get('authorization')).toBe('Bearer token123')
  })

  it('should clone the context to avoid reference issues', async () => {
    const router = os
      .$context<RequestHeadersPluginContext>()
      .route({
        method: 'GET',
        path: '/ping',
      })
      .handler(() => 'ping')

    const interceptor = vi.fn(({ next }) => next())

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new RequestHeadersPlugin(),
      ],
      interceptors: [
        interceptor,
      ],
    })

    const context = { a: 'value' }
    await handler.handle(new Request('https://example.com/ping'), { context })

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({
      context: { ...context, reqHeaders: expect.any(Headers) },
    }))

    expect(interceptor.mock.calls[0]![0].context).not.toBe(context)
  })

  it('should use the provided reqHeaders when already defined', async () => {
    const router = os
      .$context<RequestHeadersPluginContext>()
      .route({
        method: 'GET',
        path: '/ping',
      })
      .handler(() => 'ping')

    const interceptor = vi.fn(({ next }) => next())

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new RequestHeadersPlugin(),
      ],
      interceptors: [
        interceptor,
      ],
    })

    const existingHeaders = new Headers({ 'existing-header': 'existing-value' })
    const context = { a: 'value', reqHeaders: existingHeaders }
    await handler.handle(new Request('https://example.com/ping'), { context })

    expect(interceptor).toHaveBeenCalledOnce()
    expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({
      context,
    }))

    // The existing reqHeaders should be preserved
    expect(interceptor.mock.calls[0]![0].context.reqHeaders).toBe(existingHeaders)
  })

  it('leaves out invalid batch subrequest headers instead of throwing', async () => {
    let capturedHeaders: Headers | undefined

    const router = os
      .$context<RequestHeadersPluginContext>()
      .use(({ context, next }) => {
        capturedHeaders = context.reqHeaders
        return next()
      })
      .route({
        method: 'GET',
        path: '/ping',
      })
      .handler(() => 'pong')

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new RequestHeadersPlugin(),
        new BatchHandlerPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orpc-batch': 'buffered',
      },
      body: JSON.stringify([
        {
          url: 'https://example.com/ping',
          method: 'GET',
          headers: {
            'a b': '1',
            '': '2',
            'x-newline': 'a\nb',
            'x-non-latin1': '中',
            'x-object': { toString: 1 },
            'x-mixed': ['valid', 'a\nb'],
            'x-valid': 'value',
          },
        },
      ]),
    }))

    expect(response?.status).toBe(207)
    await expect(response?.json()).resolves.toEqual([
      expect.objectContaining({ index: 0, status: 200, body: 'pong' }),
    ])

    expect(Object.fromEntries(capturedHeaders!)).toEqual({
      'content-type': 'application/json',
      'x-mixed': 'valid',
      'x-orpc-batch': 'buffered',
      'x-valid': 'value',
    })
  })
})
