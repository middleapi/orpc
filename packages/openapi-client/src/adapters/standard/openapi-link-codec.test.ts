import * as ClientModule from '@orpc/client'
import * as ClientStandardModule from '@orpc/client/standard'
import * as StandardServer from '@orpc/standard-server'
import { oc } from '../../../../contract/src/builder'
import { StandardBracketNotationSerializer } from './bracket-notation'
import { StandardOpenAPIJsonSerializer } from './openapi-json-serializer'
import { StandardOpenapiLinkCodec } from './openapi-link-codec'
import { StandardOpenAPISerializer } from './openapi-serializer'

const ORPCError = ClientModule.ORPCError
const isORPCErrorStatusSpy = vi.spyOn(ClientModule, 'isORPCErrorStatus')
const mergeStandardHeadersSpy = vi.spyOn(StandardServer, 'mergeStandardHeaders')
const getMalformedResponseErrorCodeSpy = vi.spyOn(ClientStandardModule, 'getMalformedResponseErrorCode')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('standardOpenapiLinkCodecOptions', () => {
  const serializer = new StandardOpenAPISerializer(new StandardOpenAPIJsonSerializer(), new StandardBracketNotationSerializer())

  const serialize = vi.spyOn(serializer, 'serialize')
  const deserialize = vi.spyOn(serializer, 'deserialize')

  const signal = AbortSignal.timeout(100)
  const date = new Date()
  const blob = new Blob(['blob'], { type: 'text/plain' })

  describe('.encode', () => {
    it('throw error if not found procedure', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
      })

      expect(codec.encode(['test'], 'input', { context: {} })).rejects.toThrow('[StandardOpenapiLinkCodec] expect a contract procedure at test')
    })

    it('with lastEventId', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
        headers: { 'x-custom': 'value' },
      })

      const request = await codec.encode(['ping'], 'input', { context: {}, lastEventId: '1' })

      expect(mergeStandardHeadersSpy).toBeCalledWith({ 'x-custom': 'value' }, { 'last-event-id': '1' })
      expect(request.headers).toBe(mergeStandardHeadersSpy.mock.results[0]!.value)

      expect(request.headers['last-event-id']).toEqual('1')
      expect(request.headers['x-custom']).toEqual('value')
    })

    it('support fetch headers', async () => {
      const headers = new Headers()
      headers.append('cookie', 'a=1')
      headers.append('cookie', 'b=2')
      headers.append('set-cookie', 'a1=1')
      headers.append('set-cookie', 'b1=2')

      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
        headers,
      })

      const request = await codec.encode(['ping'], 'input', { context: {} })

      expect(request.headers).toEqual({
        'cookie': 'a=1; b=2',
        'set-cookie': ['a1=1', 'b1=2'],
      })
    })

    describe('inputStructure=compact', () => {
      describe('with dynamic params', () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ path: '/ping/{date}' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        it('works', async () => {
          const request = await codec.encode(['ping'], { date, a: 1, b: true }, { context: {}, signal })

          expect(request.method).toEqual('POST')
          expect(request.url.toString()).toEqual(`http://localhost:3000/ping/${encodeURIComponent(date.toISOString())}`)
          expect(request.body).toBe(serialize.mock.results[1]!.value)
          expect(request.signal).toEqual(signal)
          expect(request.headers).toEqual({ 'x-custom': 'value' })

          expect(serialize).toHaveBeenCalledTimes(2)
          expect(serialize).toHaveBeenNthCalledWith(1, date)
          expect(serialize).toHaveBeenNthCalledWith(2, { a: 1, b: true })
        })

        it('throw on invalid input', async () => {
          await expect(codec.encode(['ping'], 'invalid', { context: {}, signal })).rejects.toThrow('Invalid input')
        })

        it('body=undefined when all field used for dynamic params', async () => {
          const request = await codec.encode(['ping'], { date }, { context: {}, signal })

          expect(request.method).toEqual('POST')
          expect(request.url.toString()).toEqual(`http://localhost:3000/ping/${encodeURIComponent(date.toISOString())}`)
          expect(request.body).toBeUndefined()
          expect(request.signal).toEqual(signal)
          expect(request.headers).toEqual({ 'x-custom': 'value' })

          expect(serialize).toHaveBeenCalledTimes(2)
          expect(serialize).toHaveBeenCalledWith(date)
          expect(serialize).toHaveBeenCalledWith(undefined)
        })
      })

      it('with method=GET', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ method: 'GET' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom-header': 'custom-value' },
        })

        const request = await codec.encode(['ping'], { date, blob }, { context: {}, signal })

        expect(request.method).toEqual('GET')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping?date=${encodeURIComponent(date.toISOString())}`)
        expect(request.body).toBeUndefined()
        expect(request.signal).toEqual(signal)
        expect(request.headers).toEqual({ 'x-custom-header': 'custom-value' })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith({ date, blob }, { outputFormat: 'URLSearchParams' })
      })

      it('with method=POST', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ method: 'POST' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom-header': 'custom-value' },
        })

        const request = await codec.encode(['ping'], { date, blob }, { context: {}, signal })

        expect(request.method).toEqual('POST')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping`)
        expect(request.body).toBe(serialize.mock.results[0]!.value)
        expect(request.signal).toEqual(signal)
        expect(request.headers).toEqual({ 'x-custom-header': 'custom-value' })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith({ date, blob })
      })
    })

    describe('inputStructure=detailed', () => {
      describe('with dynamic params', () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ path: '/ping/{date}', inputStructure: 'detailed' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        it('works', async () => {
          const request = await codec.encode(['ping'], { params: { date } }, { context: {}, signal })

          expect(request.method).toEqual('POST')
          expect(request.url.toString()).toEqual(`http://localhost:3000/ping/${encodeURIComponent(date.toISOString())}`)
          expect(request.body).toBeUndefined()
          expect(request.signal).toEqual(signal)
          expect(request.headers).toEqual({ 'x-custom': 'value' })

          expect(serialize).toHaveBeenCalledTimes(2)
          expect(serialize).toHaveBeenNthCalledWith(1, date)
          expect(serialize).toHaveBeenNthCalledWith(2, undefined)
        })

        it('throw on invalid input.params', async () => {
          await expect(codec.encode(['ping'], { params: 'invalid' }, { context: {}, signal })).rejects.toThrow('Invalid input.params shape for "detailed" structure when has dynamic params at ping.')
        })
      })

      it('query', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed' }) }, serializer, {
          url: 'http://localhost:3000',
        })

        const request = await codec.encode(['ping'], { query: { b: true, date } }, { context: {}, signal })

        expect(request.method).toEqual('POST')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping?b=true&date=${encodeURIComponent(date.toISOString())}`)
        expect(request.body).toBeUndefined()
        expect(request.signal).toEqual(signal)

        expect(serialize).toHaveBeenCalledTimes(2)
        expect(serialize).toHaveBeenNthCalledWith(1, { b: true, date }, { outputFormat: 'URLSearchParams' })
        expect(serialize).toHaveBeenNthCalledWith(2, undefined)
      })

      describe('headers', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        it('works', async () => {
          const request = await codec.encode(['ping'], { headers: { a: '1', b: 'true' } }, { context: {}, signal })

          expect(request.method).toEqual('POST')
          expect(request.url.toString()).toEqual(`http://localhost:3000/ping`)
          expect(request.body).toBeUndefined()
          expect(request.signal).toEqual(signal)
          expect(request.headers).toEqual({ 'x-custom': 'value', 'a': '1', 'b': 'true' })

          expect(serialize).toHaveBeenCalledTimes(1)
          expect(serialize).toHaveBeenCalledWith(undefined)

          expect(mergeStandardHeadersSpy).toHaveBeenCalledTimes(1)
          expect(mergeStandardHeadersSpy).toHaveBeenCalledWith({ a: '1', b: 'true' }, { 'x-custom': 'value' })
        })

        it('throw if input.headers is not an object', async () => {
          await expect(codec.encode(['ping'], { headers: 'invalid' }, { context: {}, signal })).rejects.toThrow('Invalid input.headers shape for "detailed" structure at ping.')
        })
      })

      it('body', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        const request = await codec.encode(['ping'], { body: { a: 1, b: true, blob } }, { context: {}, signal })

        expect(request.method).toEqual('POST')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping`)
        expect(request.body).toBe(serialize.mock.results[0]!.value)
        expect(request.signal).toEqual(signal)
        expect(request.headers).toEqual({ 'x-custom': 'value' })

        expect(serialize).toHaveBeenCalledTimes(1)
        expect(serialize).toHaveBeenNthCalledWith(1, { a: 1, b: true, blob })
      })

      it('with method=GET', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed', method: 'GET' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        const request = await codec.encode(['ping'], { query: { query: true }, headers: { 'x-orpc': 'value' }, body: { blob } }, { context: {}, signal })

        expect(request.method).toEqual('GET')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping?query=true`)
        expect(request.body).toBe(undefined)
        expect(request.signal).toEqual(signal)
        expect(request.headers).toBe(mergeStandardHeadersSpy.mock.results[0]!.value)

        expect(serialize).toHaveBeenCalledTimes(1)
        expect(serialize).toHaveBeenCalledWith({ query: true }, { outputFormat: 'URLSearchParams' })

        expect(mergeStandardHeadersSpy).toHaveBeenCalledTimes(1)
        expect(mergeStandardHeadersSpy).toHaveBeenCalledWith({ 'x-orpc': 'value' }, { 'x-custom': 'value' })
      })

      it('with method=POST', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed', method: 'POST' }) }, serializer, {
          url: 'http://localhost:3000',
          headers: { 'x-custom': 'value' },
        })

        const request = await codec.encode(['ping'], { query: { query: true }, headers: { 'x-orpc': 'value' }, body: { blob } }, { context: {}, signal })

        expect(request.method).toEqual('POST')
        expect(request.url.toString()).toEqual(`http://localhost:3000/ping?query=true`)
        expect(request.body).toBe(serialize.mock.results[1]!.value)
        expect(request.signal).toEqual(signal)
        expect(request.headers).toBe(mergeStandardHeadersSpy.mock.results[0]!.value)

        expect(serialize).toHaveBeenCalledTimes(2)
        expect(serialize).toHaveBeenNthCalledWith(1, { query: true }, { outputFormat: 'URLSearchParams' })
        expect(serialize).toHaveBeenNthCalledWith(2, { blob })

        expect(mergeStandardHeadersSpy).toHaveBeenCalledTimes(1)
        expect(mergeStandardHeadersSpy).toHaveBeenCalledWith({ 'x-orpc': 'value' }, { 'x-custom': 'value' })
      })

      it('throw on invalid input shape', async () => {
        const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ inputStructure: 'detailed' }) }, serializer, {
          url: 'http://localhost:3000',
        })

        await expect(codec.encode(['ping'], 'invalid', { context: {}, signal })).rejects.toThrow('Invalid input')
      })
    })

    describe('base url', () => {
      it('works with /prefix', async () => {
        const codec = new StandardOpenapiLinkCodec({ test: oc.route({ path: '/test', method: 'GET' }) }, serializer, {
          url: 'http://localhost:3000/prefix',
        })

        const request = await codec.encode(['test'], { value: '123' }, { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?value=123')
      })

      it('works with /prefix/', async () => {
        const codec = new StandardOpenapiLinkCodec({ test: oc.route({ path: '/test', method: 'GET' }) }, serializer, {
          url: 'http://localhost:3000/prefix/',
        })

        const request = await codec.encode(['test'], { value: '123' }, { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?value=123')
      })

      it('works with /prefix/?a=5', async () => {
        const codec = new StandardOpenapiLinkCodec({ test: oc.route({ path: '/test', method: 'GET' }) }, serializer, {
          url: 'http://localhost:3000/prefix/?a=5',
        })

        const request = await codec.encode(['test'], { value: '123' }, { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?a=5&value=123')
      })
    })
  })

  describe('.decode', () => {
    const form = new FormData()

    it('outputStructure=compact', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ outputStructure: 'compact' }) }, serializer, {
        url: 'http://localhost:3000',
      })

      const output = await codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => form,
        status: 201,
      }, { context: {}, signal }, ['ping'])

      expect(output).toBe(deserialize.mock.results[0]!.value)

      expect(deserialize).toHaveBeenCalledTimes(1)
      expect(deserialize).toHaveBeenCalledWith(form)

      expect(isORPCErrorStatusSpy).toHaveBeenCalledTimes(1)
      expect(isORPCErrorStatusSpy).toHaveBeenCalledWith(201)
    })

    it('outputStructure=detailed', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc.route({ outputStructure: 'detailed' }) }, serializer, {
        url: 'http://localhost:3000',
      })

      const output = await codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => form,
        status: 201,
      }, { context: {}, signal }, ['ping'])

      expect(output).toEqual({
        status: 201,
        headers: { 'x-custom': 'value' },
        body: deserialize.mock.results[0]!.value,
      })

      expect((output as any).body).toBe(deserialize.mock.results[0]!.value)

      expect(deserialize).toHaveBeenCalledTimes(1)
      expect(deserialize).toHaveBeenCalledWith(form)

      expect(isORPCErrorStatusSpy).toHaveBeenCalledTimes(1)
      expect(isORPCErrorStatusSpy).toHaveBeenCalledWith(201)
    })

    it('deserialize error', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
      })

      await expect(codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => new ORPCError('BAD_GATEWAY', { status: 501, message: 'message', data: 'data' }).toJSON(),
        status: 501,
      }, { context: {}, signal }, ['ping'])).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(ORPCError)
        expect(error.code).toEqual('BAD_GATEWAY')
        expect(error.status).toBe(501)
        expect(error.message).toBe('message')
        expect(error.data).toBe('data')

        return true
      })

      getMalformedResponseErrorCodeSpy.mockReturnValueOnce('__MOCKED_CODE__')

      await expect(codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => ({ something: 'data' }),
        status: 409,
      }, { context: {}, signal }, ['ping'])).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(ORPCError)
        expect(error.defined).toBe(false)
        expect(error.code).toEqual('__MOCKED_CODE__')
        expect(error.status).toBe(409)
        expect(error.data).toEqual({
          body: {
            something: 'data',
          },
          headers: {
            'x-custom': 'value',
          },
          status: 409,
        })

        return true
      })

      expect(isORPCErrorStatusSpy).toHaveBeenCalledTimes(2)
      expect(isORPCErrorStatusSpy).toHaveBeenCalledWith(501)
      expect(isORPCErrorStatusSpy).toHaveBeenCalledWith(409)

      expect(getMalformedResponseErrorCodeSpy).toHaveBeenCalledTimes(1)
      expect(getMalformedResponseErrorCodeSpy).toHaveBeenCalledWith(409)
    })

    it('throw if not found a procedure', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
      })

      await expect(codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => form,
        status: 201,
      }, { context: {}, signal }, ['not_found'])).rejects.toThrow('[StandardOpenapiLinkCodec] expect a contract procedure at not_found')
    })

    it('throw if cannot parse response body', async () => {
      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
      })

      await expect(codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => { throw new Error('Invalid response body') },
        status: 201,
      }, { context: {}, signal }, ['ping'])).rejects.toThrow('Cannot parse response body, please check the response body and content-type.')
    })

    it('throw if deserialization fails', async () => {
      deserialize.mockImplementationOnce(() => {
        throw new Error('Cannot parse response body')
      })

      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
      })

      await expect(codec.decode({
        headers: { 'x-custom': 'value' },
        body: async () => form,
        status: 201,
      }, { context: {}, signal }, ['ping'])).rejects.toThrow('Invalid OpenAPI response format.')
    })

    it('customErrorResponseBodyDecoder', async () => {
      const error = new ORPCError('TEST')
      let time = 1
      const customErrorResponseBodyDecoder = vi.fn(() => {
        if (time++ === 2) {
          return null // fallback to default
        }
        return error
      })

      const codec = new StandardOpenapiLinkCodec({ ping: oc }, serializer, {
        url: 'http://localhost:3000',
        customErrorResponseBodyDecoder,
      })

      const response1 = { headers: { 'x-custom': 'value' }, body: async () => 'body', status: 400 }
      await expect(codec.decode(response1, { context: {} }, ['ping'])).rejects.toSatisfy(e => e === error)

      const response2 = { headers: { 'x-custom': 'value2' }, body: async () => 'body2', status: 405 }
      await expect(codec.decode(response2, { context: {} }, ['ping'])).rejects.toSatisfy(e => e.status === 405) // default behavior

      expect(customErrorResponseBodyDecoder).toHaveBeenCalledTimes(2)
      expect(customErrorResponseBodyDecoder).toHaveBeenCalledWith(deserialize.mock.results[0]!.value, response1)
      expect(customErrorResponseBodyDecoder).toHaveBeenCalledWith(deserialize.mock.results[1]!.value, response2)
    })
  })
})
