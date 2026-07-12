import { OpenAPIHandler } from '../../../openapi/src/adapters/fetch/openapi-handler'
import { os } from '../builder'
import { CORSPlugin } from './cors'

function assertResponse(response: Response | undefined): asserts response is Response {
  if (!response) {
    throw new Error('response is undefined')
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('corsPlugin', () => {
  const handlerFn = vi.fn(() => 'pong')
  const router = os
    .route({
      method: 'GET',
      path: '/ping',
    })
    .handler(handlerFn)

  it('handles OPTIONS request with default options', async () => {
    const handler = new OpenAPIHandler(router, {
      plugins: [new CORSPlugin()],
    })

    const { response } = await handler.handle(new Request('https://example.com', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
      },
    }))

    assertResponse(response)
    expect(handlerFn).toHaveBeenCalledTimes(0)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, PUT, POST, DELETE, PATCH')
    expect(response.headers.get('access-control-max-age')).toBeNull()
  })

  it('handles GET request and sets CORS headers with default origin function', async () => {
    const handler = new OpenAPIHandler(router, {
      plugins: [new CORSPlugin()],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        origin: 'https://example.com',
      },
    }))

    assertResponse(response)
    expect(handlerFn).toHaveBeenCalledTimes(1)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
    expect(response.headers.get('vary')).toBe('Origin')
  })

  it('applies maxAge and allowHeaders on OPTIONS requests when specified', async () => {
    const plugin = new CORSPlugin({
      maxAge: 600,
      allowHeaders: ['Content-Type', 'Authorization'],
    })

    const handler = new OpenAPIHandler(router, {
      plugins: [plugin],
    })

    const { response } = await handler.handle(new Request('https://example.com/test', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
      },
    }))

    assertResponse(response)
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, PUT, POST, DELETE, PATCH')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization')
  })

  it('sets allowed origin only when custom origin function approves', async () => {
    // Custom origin function: only allow 'https://allowed.com'
    const customOrigin = (origin: string) => origin === 'https://allowed.com' ? origin : ''
    const router = os
      .route({
        method: 'GET',
        path: '/custom',
      })
      .handler(() => 'ok')

    const plugin = new CORSPlugin({ origin: customOrigin })
    const handler = new OpenAPIHandler(router, {
      plugins: [plugin],
    })

    // Request from allowed origin
    const { response } = await handler.handle(new Request('https://example.com/custom', {
      headers: {
        origin: 'https://allowed.com',
      },
    }))
    assertResponse(response)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://allowed.com')

    // Request from a disallowed origin should not get the header set
    const { response: response2 } = await handler.handle(new Request('https://example.com/custom', {
      headers: {
        origin: 'https://disallowed.com',
      },
    }))
    assertResponse(response2)
    expect(response2.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('handles timingOrigin option correctly', async () => {
    // Custom timingOrigin: only allow 'https://timing.com'
    const customTimingOrigin = (origin: string) => origin === 'https://timing.com' ? origin : ''
    const router = os
      .route({
        method: 'GET',
        path: '/timing',
      })
      .handler(() => 'ok')

    const plugin = new CORSPlugin({ timingOrigin: customTimingOrigin })
    const handler = new OpenAPIHandler(router, {
      plugins: [plugin],
    })

    // Request with allowed timing origin
    const { response } = await handler.handle(new Request('https://example.com/timing', {
      headers: {
        origin: 'https://timing.com',
      },
    }))
    assertResponse(response)
    expect(response.headers.get('timing-allow-origin')).toBe('https://timing.com')

    // Request with not allowed timing origin should not have the header
    const { response: response2 } = await handler.handle(new Request('https://example.com/timing', {
      headers: {
        origin: 'https://not-timing.com',
      },
    }))
    assertResponse(response2)
    expect(response2.headers.get('timing-allow-origin')).toBeNull()
  })

  it('sets credentials and exposeHeaders when specified in options', async () => {
    const plugin = new CORSPlugin({
      credentials: true,
      exposeHeaders: ['X-Custom-Header', 'X-Another-Header'],
    })

    const handler = new OpenAPIHandler(router, {
      plugins: [plugin],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        origin: 'https://example.com',
      },
    }))
    assertResponse(response)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-expose-headers')).toBe('X-Custom-Header, X-Another-Header')
  })

  it('returns "*" for access-control-allow-origin when origin function returns "*"', async () => {
    const plugin = new CORSPlugin({ origin: () => '*' })
    const handler = new OpenAPIHandler(router, {
      plugins: [plugin],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        origin: 'https://any-origin.com',
      },
    }))
    assertResponse(response)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('vary')).toBeNull()
  })

  it('does not copy Vary from the request', async () => {
    const handler = new OpenAPIHandler(router, {
      plugins: [new CORSPlugin()],
    })

    const { response } = await handler.handle(new Request('https://example.com', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        vary: 'Accept-Encoding',
      },
    }))

    assertResponse(response)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com')
    expect(response.headers.get('vary')).toBe('Origin')
  })

  it('appends Origin to an existing response Vary header', async () => {
    const handler = new OpenAPIHandler(router, {
      plugins: [
        {
          init(options) {
            options.rootInterceptors ??= []
            options.rootInterceptors.unshift(async (opts) => {
              const result = await opts.next()
              if (!result.matched) {
                return result
              }
              return {
                ...result,
                response: {
                  ...result.response,
                  headers: {
                    ...result.response.headers,
                    vary: 'Accept-Encoding',
                  },
                },
              }
            })
          },
        },
        new CORSPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        origin: 'https://example.com',
      },
    }))

    assertResponse(response)
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin')
  })

  it('does not duplicate Origin in Vary when already present', async () => {
    const handler = new OpenAPIHandler(router, {
      plugins: [
        {
          init(options) {
            options.rootInterceptors ??= []
            options.rootInterceptors.unshift(async (opts) => {
              const result = await opts.next()
              if (!result.matched) {
                return result
              }
              return {
                ...result,
                response: {
                  ...result.response,
                  headers: {
                    ...result.response.headers,
                    vary: 'Accept-Encoding, origin',
                  },
                },
              }
            })
          },
        },
        new CORSPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/ping', {
      headers: {
        origin: 'https://example.com',
      },
    }))

    assertResponse(response)
    expect(response.headers.get('vary')).toBe('Accept-Encoding, origin')
  })
})
