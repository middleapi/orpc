import * as StandardServer from '@orpc/standard-server'
import * as ErrorModule from '../../error'
import { StandardRPCJsonSerializer } from './rpc-json-serializer'
import { StandardRPCLinkCodec } from './rpc-link-codec'
import { StandardRPCSerializer } from './rpc-serializer'
import * as UtilsModule from './utils'

const ORPCError = ErrorModule.ORPCError
const isORPCErrorStatusSpy = vi.spyOn(ErrorModule, 'isORPCErrorStatus')
const mergeStandardHeadersSpy = vi.spyOn(StandardServer, 'mergeStandardHeaders')
const getMalformedResponseErrorCodeSpy = vi.spyOn(UtilsModule, 'getMalformedResponseErrorCode')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('standardRPCLinkCodec', () => {
  const serializer = new StandardRPCSerializer(new StandardRPCJsonSerializer())

  const serializeSpy = vi.spyOn(serializer, 'serialize')
  const deserializeSpy = vi.spyOn(serializer, 'deserialize')

  describe('encode', () => {
    const method = vi.fn()
    const codec = new StandardRPCLinkCodec(serializer, {
      url: 'http://localhost:3000',
      method,
      headers: () => ({ 'x-custom-header': 'custom-value' }),
    })

    it('with method=GET', async () => {
      method.mockResolvedValueOnce('GET')

      const signal = AbortSignal.timeout(100)
      const output = await codec.encode(['test'], 'input', { context: {}, signal })

      expect(output).toEqual(expect.objectContaining({
        url: new URL(`http://localhost:3000/test?data=${encodeURIComponent(JSON.stringify(serializeSpy.mock.results[0]!.value))}`),
        method: 'GET',
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: undefined,
        signal,
      }))
    })

    it('with method=POST', async () => {
      method.mockResolvedValueOnce('POST')

      const signal = AbortSignal.timeout(100)
      const output = await codec.encode(['test'], 'input', { context: {}, signal })

      expect(output).toEqual(expect.objectContaining({
        url: new URL(`http://localhost:3000/test`),
        method: 'POST',
        headers: {
          'x-custom-header': 'custom-value',
        },
        body: serializeSpy.mock.results[0]!.value,
        signal,
      }))
    })

    it.each([
      ['exceeds max length', '_'.repeat(100)],
      ['blob', new Blob(['blob'], { type: 'text/plain' })],
      ['blob inside', { blob: new Blob(['blob'], { type: 'text/plain' }) }],
      ['event-iterator', (async function* () { })()],
    ])('fallback method when method=GET: %s', async (_, input) => {
      const codec = new StandardRPCLinkCodec(serializer, {
        url: 'http://localhost:3000',
        method: 'GET',
        maxUrlLength: 100,
        fallbackMethod: 'PATCH',
      })

      const output = await codec.encode(['test'], input, { context: {} })

      expect(output).toEqual(expect.objectContaining({
        url: new URL(`http://localhost:3000/test`),
        method: 'PATCH',
        headers: {},
        body: serializeSpy.mock.results[0]!.value,
      }))

      expect(serializeSpy).toBeCalledTimes(1)
      expect(serializeSpy).toBeCalledWith(input)
    })

    it('last-event-id', async () => {
      const codec = new StandardRPCLinkCodec(serializer, {
        url: 'http://localhost:3000',
        method,
        headers: () => ({ 'x-custom-header': 'custom-value' }),
      })

      const request = await codec.encode(['test'], 'input', { context: {}, lastEventId: '1' })

      expect(request.headers['last-event-id']).toEqual('1')

      expect(mergeStandardHeadersSpy).toBeCalledWith({ 'x-custom-header': 'custom-value' }, { 'last-event-id': '1' })
      expect(mergeStandardHeadersSpy).toBeCalledTimes(1)
      expect(request.headers).toBe(mergeStandardHeadersSpy.mock.results[0]!.value)
    })

    it('support fetch headers', async () => {
      const headers = new Headers()
      headers.append('cookie', 'a=1')
      headers.append('cookie', 'b=2')
      headers.append('set-cookie', 'a1=1')
      headers.append('set-cookie', 'b1=2')

      const codec = new StandardRPCLinkCodec(serializer, {
        url: 'http://localhost:3000',
        headers,
      })

      const request = await codec.encode(['test'], 'input', { context: {} })

      expect(request.headers).toEqual({
        'cookie': 'a=1; b=2',
        'set-cookie': ['a1=1', 'b1=2'],
      })
    })

    describe('base url', () => {
      it('works with /prefix', async () => {
        const codec = new StandardRPCLinkCodec(serializer, {
          url: 'http://localhost:3000/prefix',
          method: 'GET',
        })

        const request = await codec.encode(['test'], 'input', { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?data=%7B%22json%22%3A%22input%22%7D')
      })

      it('works with /prefix/', async () => {
        const codec = new StandardRPCLinkCodec(serializer, {
          url: 'http://localhost:3000/prefix/',
          method: 'GET',
        })

        const request = await codec.encode(['test'], 'input', { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?data=%7B%22json%22%3A%22input%22%7D')
      })

      it('works with /prefix/?a=5', async () => {
        const codec = new StandardRPCLinkCodec(serializer, {
          url: 'http://localhost:3000/prefix/?a=5',
          method: 'GET',
        })

        const request = await codec.encode(['test'], 'input', { context: {} })

        expect(request.url.toString()).toEqual('http://localhost:3000/prefix/test?a=5&data=%7B%22json%22%3A%22input%22%7D')
      })
    })
  })

  describe('decode', () => {
    const codec = new StandardRPCLinkCodec(serializer, {
      url: 'http://localhost:3000',
    })

    it('should decode output', async () => {
      const serialized = serializer.serialize({
        data: 'hello world',
      })

      const output = await codec.decode({
        status: 200,
        headers: {},
        body: () => Promise.resolve(serialized),
      })

      expect(output).toEqual(deserializeSpy.mock.results[0]!.value)

      expect(deserializeSpy).toBeCalledTimes(1)
      expect(deserializeSpy).toBeCalledWith(serialized)

      expect(isORPCErrorStatusSpy).toBeCalledTimes(1)
      expect(isORPCErrorStatusSpy).toBeCalledWith(200)
    })

    it('should decode error', async () => {
      const error = new ORPCError('TEST', {
        data: {
          message: 'hello world',
        },
      })

      const serialized = serializer.serialize(error.toJSON())

      await expect(codec.decode({
        status: 499,
        headers: {},
        body: () => Promise.resolve(serialized),
      })).rejects.toSatisfy((e) => {
        expect(e).toEqual(error)

        return true
      })

      expect(deserializeSpy).toBeCalledTimes(1)
      expect(deserializeSpy).toBeCalledWith(serialized)

      expect(isORPCErrorStatusSpy).toBeCalledTimes(1)
      expect(isORPCErrorStatusSpy).toBeCalledWith(499)
    })

    it.each([300, 301, 302, 304, 307, 308, 399])('error: redirect response %i', async (status) => {
      const body = vi.fn(() => Promise.resolve(undefined))

      await expect(codec.decode({
        status,
        headers: { location: 'http://localhost:3000/login' },
        body,
      })).rejects.toThrow(`Unexpected redirect response (status ${status}): RPCLink does not follow redirects.`)

      expect(body).toBeCalledTimes(0)
      expect(deserializeSpy).toBeCalledTimes(0)
    })

    it('error: Cannot parse response body', async () => {
      await expect(codec.decode({
        status: 200,
        headers: {},
        body: () => {
          throw new Error('test')
        },
      })).rejects.toThrow('Cannot parse response body, please check the response body and content-type.')

      expect(deserializeSpy).toBeCalledTimes(0)
    })

    it('error: Invalid RPC response format.', async () => {
      await expect(codec.decode({
        status: 200,
        headers: {},
        body: () => Promise.resolve({ meta: 123 }),
      })).rejects.toThrow('Invalid RPC response format.')

      expect(deserializeSpy).toBeCalledTimes(1)
      expect(deserializeSpy).toBeCalledWith({ meta: 123 })
    })

    it('error: Malformed Response Error', async () => {
      const error = new ORPCError('TEST', {
        data: {
          message: 'hello world',
        },
      })

      const serialized = serializer.serialize({ something: 'value' }) as any

      getMalformedResponseErrorCodeSpy.mockReturnValueOnce('__MOCKED_CODE__')

      await expect(codec.decode({
        status: 403,
        headers: {},
        body: () => Promise.resolve(serialized),
      })).rejects.toSatisfy((e) => {
        expect(e).toBeInstanceOf(ORPCError)
        expect(e.defined).toBe(false)
        expect(e.code).toEqual('__MOCKED_CODE__')
        expect(e.data).toEqual({
          body: {
            something: 'value',
          },
          headers: {},
          status: 403,
        })

        return true
      })

      expect(deserializeSpy).toBeCalledTimes(1)
      expect(deserializeSpy).toBeCalledWith(serialized)

      expect(getMalformedResponseErrorCodeSpy).toBeCalledTimes(1)
      expect(getMalformedResponseErrorCodeSpy).toBeCalledWith(403)
    })
  })
})
