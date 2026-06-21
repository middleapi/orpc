import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import { openapi } from '../../meta'
import { OpenAPISerializer } from '../../openapi-serializer'
import { OpenAPILinkCodec } from './openapi-link-codec'

const serializer = new OpenAPISerializer()

function expectORPCErrorResult(
  result: any,
  code: string,
  options?: {
    message?: string
    data?: unknown
  },
) {
  expect(result.kind).toBe('error')
  expect(result.error).toBeInstanceOf(ORPCError)
  expect(result.error.code).toBe(code)

  if (options?.message !== undefined) {
    expect(result.error.message).toBe(options.message)
  }

  if (options?.data !== undefined) {
    expect(result.error.data).toEqual(options.data)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openAPILinkCodec', () => {
  describe('.encodeInput', () => {
    describe('compact requests', () => {
      it('builds a POST request with default method, path, and headers', async () => {
        const codec = new OpenAPILinkCodec({
          ping: oc.meta(openapi({})),
        })

        const request = await codec.encodeInput('input', ['ping'], { context: {} })

        expect(request).toEqual({
          method: 'POST',
          url: '/ping',
          headers: {},
          body: 'input',
          signal: undefined,
        })
      })

      it('builds a GET request with a prefixed path and mixed query styles', async () => {
        const codec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            method: 'GET',
            prefix: '/v1',
            path: '/items/{id}',
            paramsStyles: {
              id: 'primitive',
            },
            queryStyles: {
              keyword: 'primitive',
              tags: 'array',
              filters: 'comma-delimited-object',
              meta: 'json',
            },
          })),
        }, {
          url: '/api?existing=1#frag',
          headers: { 'x-client': 'openapi' },
          serializer,
        })

        const request = await codec.encodeInput({
          id: '42',
          keyword: 'latest',
          tags: ['red', 'blue'],
          filters: { size: 'large', brand: 'nike' },
          meta: { enabled: true },
          plain: { nested: true },
          file: new Blob(['file']),
        }, ['item'], { context: {}, lastEventId: 'evt-1' })

        expect(request.method).toBe('GET')
        expect(request.body).toBeUndefined()
        expect(request.headers).toEqual({
          'x-client': 'openapi',
          'last-event-id': 'evt-1',
        })

        const url = new URL(request.url, 'http://localhost')
        expect(url.hash).toBe('#frag')
        expect(url.pathname).toBe('/api/v1/items/42')
        expect(url.searchParams.get('existing')).toBe('1')
        expect(url.searchParams.get('keyword')).toBe('latest')
        expect(url.searchParams.getAll('tags')).toEqual(['red', 'blue'])
        expect(url.searchParams.get('filters')).toBe('size,large,brand,nike')
        expect(url.searchParams.get('meta')).toBe('{"enabled":true}')
        expect(url.searchParams.get('plain[nested]')).toBe('true')
        expect(url.searchParams.get('file')).toBe('[object File]')
      })

      it('rejects non-object input when dynamic path params must be resolved', async () => {
        const codec = new OpenAPILinkCodec({
          ping: oc.meta(openapi({ path: '/items/{id}' })),
        }, { serializer })

        await expect(codec.encodeInput('invalid', ['ping'], { context: {} })).rejects.toThrow(
          'Input must be an object with "compact" input structure when the path has dynamic params (id) in call to procedure (ping).',
        )
      })
    })

    describe('detailed requests', () => {
      it('builds a request with styled params, styled query, and merged headers', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'POST',
            path: '/search/{tags}',
            inputStructure: 'detailed',
            paramsStyles: {
              tags: 'comma-delimited-array',
            },
            queryStyles: {
              meta: 'json',
            },
          })),
        }, {
          url: '/api',
          headers: { 'x-base': '1' },
          serializer,
        })

        const request = await codec.encodeInput({
          params: { tags: ['alpha', 'beta'] },
          query: { meta: { enabled: true } },
          headers: { 'x-request': '2' },
          body: { title: 'Hello' },
        }, ['search'], { context: {} })

        expect(request).toEqual({
          method: 'POST',
          url: '/api/search/alpha,beta?meta=%7B%22enabled%22%3Atrue%7D',
          headers: { 'x-request': '2', 'x-base': '1' },
          body: { title: 'Hello' },
          signal: undefined,
        })
      })

      it('uses base headers when detailed input omits the headers field', async () => {
        const codec = new OpenAPILinkCodec({
          ping: oc.meta(openapi({ inputStructure: 'detailed' })),
        }, {
          url: '/api',
          headers: { 'x-base': 'yes' },
          serializer,
        })

        const request = await codec.encodeInput({ body: 'data' }, ['ping'], { context: {} })

        expect(request.headers).toEqual({ 'x-base': 'yes' })
      })

      it('omits the body for GET requests while still serializing the query', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            inputStructure: 'detailed',
            queryStyles: { q: 'primitive' },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({
          query: { q: 'hello' },
          body: 'should be omitted',
        }, ['search'], { context: {} })

        expect(request.method).toBe('GET')
        expect(request.body).toBeUndefined()
        expect(request.url).toBe('/api/search?q=hello')
      })

      it('rejects invalid detailed input shapes', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            path: '/users/{id}',
            inputStructure: 'detailed',
          })),
        }, { serializer })

        await expect(codec.encodeInput('invalid', ['search'], { context: {} })).rejects.toThrow(
          'Invalid "detailed" input structure in call to procedure (search):',
        )

        await expect(codec.encodeInput({ query: 'invalid' }, ['search'], { context: {} })).rejects.toThrow(
          'Invalid "detailed" input structure in call to procedure (search):',
        )

        await expect(codec.encodeInput({ headers: 'invalid' }, ['search'], { context: {} })).rejects.toThrow(
          'Invalid "detailed" input structure in call to procedure (search):',
        )

        await expect(codec.encodeInput({ params: 'invalid' }, ['search'], { context: {} })).rejects.toThrow(
          'Invalid "detailed" input structure in call to procedure (search):',
        )
      })

      it('requires params when the detailed path contains dynamic segments', async () => {
        const codec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{id}',
            inputStructure: 'detailed',
          })),
        }, { serializer })

        await expect(codec.encodeInput({}, ['item'], { context: {} })).rejects.toThrow(
          'The "params" property is required for "detailed" input when the path has dynamic params',
        )

        await expect(codec.encodeInput({ params: {} }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "id" cannot be empty in call to procedure (item).',
        )
      })
    })

    describe('query serialization', () => {
      it('serializes and preserves literal commas for comma-delimited styles', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              tags: 'comma-delimited-array',
              filters: 'comma-delimited-object',
            },
          })),
        }, {
          url: '/api',
          serializer,
        })

        const request = await codec.encodeInput({
          tags: ['alpha/', 'beta'],
          filters: { 'size/': 'large/', 'brand': 'nike' },
        }, ['search'], { context: {} })

        expect(request.url).toBe('/api/search?tags=alpha%2F,beta&filters=size%2F,large%2F,brand,nike')
      })

      it('serializes space-delimited and pipe-delimited query styles', async () => {
        const spaceDelimitedCodec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              tags: 'space-delimited-array',
              filters: 'space-delimited-object',
            },
          })),
        }, { url: '/api', serializer })

        const pipeDelimitedCodec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              tags: 'pipe-delimited-array',
              filters: 'pipe-delimited-object',
            },
          })),
        }, { url: '/api', serializer })

        const spaceDelimitedRequest = await spaceDelimitedCodec.encodeInput({
          tags: ['a/', 'b'],
          filters: { 'x/': '1/', 'y': '2' },
        }, ['search'], { context: {} })

        const pipeDelimitedRequest = await pipeDelimitedCodec.encodeInput({
          tags: ['a/', 'b'],
          filters: { 'x/': '1/', 'y': '2' },
        }, ['search'], { context: {} })

        const spaceDelimitedUrl = new URL(spaceDelimitedRequest.url, 'http://localhost')
        const pipeDelimitedUrl = new URL(pipeDelimitedRequest.url, 'http://localhost')

        expect(spaceDelimitedUrl.searchParams.get('tags')).toBe('a/ b')
        expect(spaceDelimitedUrl.searchParams.get('filters')).toBe('x/ 1/ y 2')
        expect(pipeDelimitedUrl.searchParams.get('tags')).toBe('a/|b')
        expect(pipeDelimitedUrl.searchParams.get('filters')).toBe('x/|1/|y|2')
      })

      it('treats a scalar as primitive input for array/object query styles', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              commaArray: 'comma-delimited-array',
              commaObject: 'comma-delimited-object',
              spaceArray: 'space-delimited-array',
              spaceObject: 'space-delimited-object',
              pipeArray: 'pipe-delimited-array',
              pipeObject: 'pipe-delimited-object',
            },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({
          commaArray: 'value1',
          commaObject: 'value2',
          spaceArray: 'value3',
          spaceObject: 'value4',
          pipeArray: 'value5',
          pipeObject: 'value6',
        }, ['search'], { context: {} })

        const searchParams = new URL(request.url, 'http://localhost').searchParams

        expect(searchParams.get('commaArray')).toBe('value1')
        expect(searchParams.get('commaObject')).toBe('value2')
        expect(searchParams.get('spaceArray')).toBe('value3')
        expect(searchParams.get('spaceObject')).toBe('value4')
        expect(searchParams.get('pipeArray')).toBe('value5')
        expect(searchParams.get('pipeObject')).toBe('value6')
      })

      it('omits undefined values for delimiter-based query styles', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              c: 'comma-delimited-array',
              d: 'comma-delimited-object',
              e: 'space-delimited-array',
              f: 'space-delimited-object',
              g: 'pipe-delimited-array',
              h: 'pipe-delimited-object',
            },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({
          c: undefined,
          d: undefined,
          e: undefined,
          f: undefined,
          g: undefined,
          h: undefined,
        }, ['search'], { context: {} })

        expect(request.url).toBe('/api/search')
      })

      it('omits empty values for delimiter-based query styles', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              commaArray: 'comma-delimited-array',
              commaObject: 'comma-delimited-object',
              spaceArray: 'space-delimited-array',
              spaceObject: 'space-delimited-object',
              pipeArray: 'pipe-delimited-array',
              pipeObject: 'pipe-delimited-object',
            },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({
          commaArray: [],
          commaObject: {},
          spaceArray: [],
          spaceObject: {},
          pipeArray: [],
          pipeObject: {},
        }, ['search'], { context: {} })

        expect(request.url).toBe('/api/search')
      })

      it('serializes compact GET input as a query when no explicit query styles are defined', async () => {
        const codec = new OpenAPILinkCodec({
          list: oc.meta(openapi({ method: 'GET' })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({ page: '2' }, ['list'], { context: {} })

        expect(request.method).toBe('GET')
        expect(request.body).toBeUndefined()
        expect(new URL(request.url, 'http://localhost').searchParams.get('page')).toBe('2')
      })

      it('keeps compact GET requests without input free of a query string', async () => {
        const codec = new OpenAPILinkCodec({
          list: oc.meta(openapi({ method: 'GET' })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput(undefined, ['list'], { context: {} })

        expect(request.url).toBe('/api/list')
        expect(request.body).toBeUndefined()
      })

      it('filter null or undefined in styled query', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({
            method: 'GET',
            queryStyles: {
              passthrough: undefined,
              optional: 'primitive',
              list: 'array',
              payload: 'json',
            },
          })),
        }, { url: '/api?existing=1', serializer })

        const request = await codec.encodeInput({
          passthrough: 'keep',
          optional: null,
          list: [undefined, 'value'],
          payload: undefined,
        }, ['search'], { context: {} })

        const url = new URL(request.url, 'http://localhost')

        expect(url.searchParams.get('existing')).toBe('1')
        expect(url.searchParams.get('passthrough')).toBe('keep')
        expect(url.searchParams.has('optional')).toBe(false)
        expect(url.searchParams.getAll('list')).toEqual(['value'])
        expect(url.searchParams.has('payload')).toBe(false)
      })

      it('preserves the base search when a compact GET request has no additional query', async () => {
        const codec = new OpenAPILinkCodec({
          search: oc.meta(openapi({ method: 'GET' })),
        }, { url: '/api?existing=1#frag', serializer })

        const request = await codec.encodeInput(undefined, ['search'], { context: {} })

        expect(request.url).toBe('/api/search?existing=1#frag')
      })
    })

    describe('path param serialization', () => {
      it('serializes and preserves literal commas for comma-delimited array/object params in the path', async () => {
        const codec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{ids}/{filter}',
            paramsStyles: { ids: 'comma-delimited-array', filter: 'comma-delimited-object' },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({ ids: ['a/', 'b', 'c'], filter: { 'color/': 'red/', 'size': 'xs' } }, ['item'], { context: {} })

        expect(request.url).toBe('/api/items/a%2F,b,c/color%2F,red%2F,size,xs')
      })

      it('serializes mixed dynamic path params', async () => {
        const codec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{id}/{+rest}',
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({
          id: 'a/b',
          rest: 'docs/v1/read me',
        }, ['item'], { context: {} })

        expect(request.url).toBe('/api/items/a%2Fb/docs/v1/read%20me')
      })

      it('treats scalar values as primitive for array/object params', async () => {
        const codec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{ids}/{filter}',
            paramsStyles: { ids: 'comma-delimited-array', filter: 'comma-delimited-object' },
          })),
        }, { url: '/api', serializer })

        const request = await codec.encodeInput({ ids: 'single1', filter: 'single2' }, ['item'], { context: {} })

        expect(request.url).toBe('/api/items/single1/single2')
      })

      it('throws when empty path params', async () => {
        const primitiveCodec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{id}',
          })),
        }, { url: '/api', serializer })

        await expect(primitiveCodec.encodeInput({ id: '' }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "id" cannot be empty in call to procedure (item).',
        )

        const arrayCodec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{id}',
            paramsStyles: { id: 'comma-delimited-array' },
          })),
        }, { url: '/api', serializer })

        await expect(arrayCodec.encodeInput({ id: [] }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "id" cannot be empty in call to procedure (item).',
        )
        await expect(arrayCodec.encodeInput({ id: '' }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "id" cannot be empty in call to procedure (item).',
        )

        const objectCodec = new OpenAPILinkCodec({
          item: oc.meta(openapi({
            path: '/items/{filter}',
            paramsStyles: { filter: 'comma-delimited-object' },
          })),
        }, { url: '/api', serializer })

        await expect(objectCodec.encodeInput({ filter: {} }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "filter" cannot be empty in call to procedure (item).',
        )
        await expect(objectCodec.encodeInput({ filter: '' }, ['item'], { context: {} })).rejects.toThrow(
          'Path param "filter" cannot be empty in call to procedure (item).',
        )
      })
    })

    describe('option handling', () => {
      it('accepts Headers instances for base headers', async () => {
        const codec = new OpenAPILinkCodec({
          ping: oc.meta(openapi({})),
        }, {
          headers: new Headers({ 'x-token': 'abc' }),
          serializer,
        })

        const request = await codec.encodeInput('input', ['ping'], { context: {} })

        expect(request.headers['x-token']).toBe('abc')
      })

      it('rejects unresolved procedure paths', async () => {
        const codec = new OpenAPILinkCodec({
          ping: oc.meta(openapi({})),
        }, { serializer })

        await expect(codec.encodeInput('input', ['nonexistent'], { context: {} })).rejects.toThrow(
          'Expected a procedure or contract at path (nonexistent)',
        )
      })
    })
  })

  describe('.decodeResponse', () => {
    it('returns compact output bodies directly', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({ outputStructure: 'compact', responseBodyHint: 'json' })),
      }, { serializer })

      const resolveBody = vi.fn(async () => ({ ok: true }))
      const result = await codec.decodeResponse({
        status: 201,
        headers: { 'x-trace': '1' },
        resolveBody,
      }, ['ping'], { context: {} })

      expect(result).toEqual({
        kind: 'output',
        output: { ok: true },
      })

      expect(resolveBody).toHaveBeenCalledTimes(1)
      expect(resolveBody).toHaveBeenCalledWith('json')
    })

    it('returns detailed output bodies with status and headers', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({ outputStructure: 'detailed', responseBodyHint: 'json' })),
      }, { serializer })

      const resolveBody = vi.fn(async () => ({ ok: true }))
      const result = await codec.decodeResponse({
        status: 202,
        headers: { 'x-trace': '1' },
        resolveBody,
      }, ['ping'], { context: {} })

      expect(result).toEqual({
        kind: 'output',
        output: {
          status: 202,
          headers: { 'x-trace': '1' },
          body: { ok: true },
        },
      })

      expect(resolveBody).toHaveBeenCalledTimes(1)
      expect(resolveBody).toHaveBeenCalledWith('json')
    })

    it('defaults successful responses to compact output when outputStructure is omitted', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, { serializer })

      const resolveBody = vi.fn(async () => undefined)
      const result = await codec.decodeResponse({
        status: 200,
        headers: { 'x-trace': '1' },
        resolveBody,
      }, ['ping'], { context: {} })

      expect(result).toEqual({
        kind: 'output',
        output: undefined,
      })

      expect(resolveBody).toHaveBeenCalledTimes(1)
      expect(resolveBody).toHaveBeenCalledWith(undefined)
    })

    it('decodes ORPC error payloads from unsuccessful responses', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, { serializer })

      const error = new ORPCError('NOT_FOUND', {
        message: 'Missing',
        data: { id: '42' },
      })

      const result = await codec.decodeResponse({
        status: 404,
        headers: {},
        resolveBody: async () => error.toJSON(),
      }, ['ping'], { context: {} })

      expectORPCErrorResult(result, 'NOT_FOUND', {
        message: 'Missing',
        data: { id: '42' },
      })
    })

    it('uses a custom error decoder when it returns a value', async () => {
      const customError = new ORPCError('BAD_GATEWAY', { data: 'custom' })
      const customErrorResponseBodyDecoder = vi.fn(() => customError)
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, {
        serializer,
        customErrorResponseBodyDecoder,
      })

      const response = {
        status: 502,
        headers: { 'x-trace': '1' },
        resolveBody: async () => ({ detail: 'bad gateway' }),
      }

      const result = await codec.decodeResponse(response, ['ping'], { context: {} })

      expect(result).toEqual({ kind: 'error', error: customError })
      expect(customErrorResponseBodyDecoder).toHaveBeenCalledOnce()
      expect(customErrorResponseBodyDecoder).toHaveBeenCalledWith({ detail: 'bad gateway' }, response)
    })

    it('falls back to standard ORPC error decoding when the custom decoder returns null', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, {
        serializer,
        customErrorResponseBodyDecoder: () => null,
      })

      const error = new ORPCError('NOT_FOUND', { message: 'Not found' })

      const result = await codec.decodeResponse({
        status: 404,
        headers: {},
        resolveBody: async () => error.toJSON(),
      }, ['ping'], { context: {} })

      expectORPCErrorResult(result, 'NOT_FOUND')
    })

    it('wraps unknown error payloads in a generic MALFORMED_ORPC_ERROR_RESPONSE ORPCError', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, { serializer })

      const result = await codec.decodeResponse({
        status: 503,
        headers: {},
        resolveBody: async () => ({ detail: 'service unavailable' }),
      }, ['ping'], { context: {} })

      expectORPCErrorResult(result, 'MALFORMED_ORPC_ERROR_RESPONSE', { data: { status: 503, headers: {}, body: { detail: 'service unavailable' } } })
    })

    it('throws when the response body cannot be read', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, { serializer })

      await expect(codec.decodeResponse({
        status: 200,
        headers: {},
        resolveBody: async () => {
          throw new Error('network error')
        },
      }, ['ping'], { context: {} })).rejects.toThrow('Cannot parse response body')
    })

    it('throws when the deserialized response body has an invalid format', async () => {
      const badSerializer: any = {
        ...serializer,
        deserialize: () => {
          throw new Error('bad format')
        },
      }

      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, {
        serializer: badSerializer,
      })

      await expect(codec.decodeResponse({
        status: 200,
        headers: {},
        resolveBody: async () => 'raw',
      }, ['ping'], { context: {} })).rejects.toThrow('Invalid OpenAPI response format')
    })

    it('rejects unresolved procedure paths', async () => {
      const codec = new OpenAPILinkCodec({
        ping: oc.meta(openapi({})),
      }, { serializer })

      await expect(codec.decodeResponse({
        status: 200,
        headers: {},
        resolveBody: async () => 'raw',
      }, ['not-exists'], { context: {} })).rejects.toThrow(
        'Expected a procedure or contract at path (not-exists)',
      )
    })
  })
})
