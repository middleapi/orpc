import { ORPCError } from '@orpc/contract'
import { Procedure } from '@orpc/server'
import { ping } from '../../../../server/tests/shared'
import { StandardOpenAPICodec } from './openapi-codec'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('standardOpenAPICodec', () => {
  const serializer = {
    serialize: vi.fn(),
    deserialize: vi.fn(),
  } as any

  const codec = new StandardOpenAPICodec(serializer)

  describe('.decode', () => {
    describe('with compact structure', () => {
      it('with GET method', async () => {
        serializer.deserialize.mockReturnValueOnce(undefined)

        const url = new URL('http://localhost/api/v1?data=data')
        url.searchParams.append('data', JSON.stringify('__data__'))

        const input = await codec.decode({
          method: 'GET',
          url,
          body: vi.fn(),
          headers: {},
          signal: undefined,
        }, { name: 'John Doe' }, ping)

        expect(input).toEqual({ name: 'John Doe' })

        expect(serializer.deserialize).toHaveBeenCalledOnce()
        expect(serializer.deserialize).toHaveBeenCalledWith(url.searchParams)
      })

      it('with non-GET method', async () => {
        const serialized = '__data__'

        serializer.deserialize.mockReturnValueOnce('__deserialized__')

        const input = await codec.decode({
          method: 'POST',
          url: new URL('http://localhost/api/v1?data=data'),
          body: vi.fn(async () => serialized),
          headers: {},
          signal: undefined,
        }, undefined, ping)

        expect(input).toEqual('__deserialized__')

        expect(serializer.deserialize).toHaveBeenCalledOnce()
        expect(serializer.deserialize).toHaveBeenCalledWith(serialized)
      })

      it('params and body are merged', async () => {
        const serialized = '__data__'

        serializer.deserialize.mockReturnValueOnce({ v1: 'v1' })

        const input = await codec.decode({
          method: 'POST',
          url: new URL('http://localhost/api/v1?data=data'),
          body: vi.fn(async () => serialized),
          headers: {},
          signal: undefined,
        }, { v2: 'v2' }, ping)

        expect(input).toEqual({ v1: 'v1', v2: 'v2' })

        expect(serializer.deserialize).toHaveBeenCalledOnce()
        expect(serializer.deserialize).toHaveBeenCalledWith(serialized)
      })
    })

    describe('with detailed structure', () => {
      const procedure = new Procedure({
        ...ping['~orpc'],
        route: {
          inputStructure: 'detailed',
        },
      })

      it('with GET method', async () => {
        serializer.deserialize.mockReturnValue('__deserialized__')

        const url = new URL('http://localhost/api/v1?data=data')
        url.searchParams.append('data', JSON.stringify('__data__'))

        const input = await codec.decode({
          method: 'GET',
          url,
          body: vi.fn(),
          headers: {
            'content-type': 'application/json',
          },
          signal: undefined,
        }, { name: 'John Doe' }, procedure)

        expect(input).toEqual({
          params: { name: 'John Doe' },
          query: '__deserialized__',
          headers: {
            'content-type': 'application/json',
          },
          body: '__deserialized__',
        })

        expect(serializer.deserialize).toHaveBeenCalledTimes(2)
        expect(serializer.deserialize).toHaveBeenNthCalledWith(1, undefined)
        expect(serializer.deserialize).toHaveBeenNthCalledWith(2, url.searchParams)
      })

      it('with non-GET method', async () => {
        const serialized = '__data__'

        serializer.deserialize.mockReturnValue('__deserialized__')
        const url = new URL('http://localhost/api/v1?data=data')

        const input = await codec.decode({
          method: 'POST',
          url,
          body: vi.fn(async () => serialized),
          headers: {
            'content-type': 'application/json',
          },
          signal: undefined,
        }, { name: 'John Doe' }, procedure)

        expect(input).toEqual({
          params: { name: 'John Doe' },
          query: '__deserialized__',
          headers: {
            'content-type': 'application/json',
          },
          body: '__deserialized__',
        })

        expect(serializer.deserialize).toHaveBeenCalledTimes(2)
        expect(serializer.deserialize).toHaveBeenNthCalledWith(1, serialized)
        expect(serializer.deserialize).toHaveBeenNthCalledWith(2, url.searchParams)
      })

      it('can set query', async () => {
        const serialized = '__data__'

        serializer.deserialize.mockReturnValue('__deserialized__')
        const url = new URL('http://localhost/api/v1?data=data')

        const input = await codec.decode({
          method: 'POST',
          url,
          body: vi.fn(async () => serialized),
          headers: {
            'content-type': 'application/json',
          },
          signal: undefined,
        }, { name: 'John Doe' }, procedure) as any

        input.query = { name: 'John Doe' }
        expect(input.query).toEqual({ name: 'John Doe' })
      })
    })
  })

  describe('.encode', async () => {
    it('with compact structure', async () => {
      serializer.serialize.mockReturnValueOnce('__serialized__')

      const response = codec.encode('__output__', ping)

      expect(response).toEqual({
        status: 200,
        headers: {},
        body: '__serialized__',
      })

      expect(serializer.serialize).toHaveBeenCalledOnce()
      expect(serializer.serialize).toHaveBeenCalledWith('__output__')
    })

    describe('with detailed structure', async () => {
      const procedure = new Procedure({
        ...ping['~orpc'],
        route: {
          outputStructure: 'detailed',
          successStatus: 298,
        },
      })

      it('works', async () => {
        serializer.serialize.mockReturnValue('__serialized__')

        const output = {
          body: '__output__',
          headers: {
            'x-custom-header': 'custom-value',
          },
        }
        const response = codec.encode(output, procedure)

        expect(response).toEqual({
          status: 298,
          headers: {
            'x-custom-header': 'custom-value',
          },
          body: '__serialized__',
        })

        expect(serializer.serialize).toHaveBeenCalledTimes(1)
        expect(serializer.serialize).toHaveBeenCalledWith('__output__')
      })

      it('works with empty output', async () => {
        serializer.serialize.mockReturnValue('__serialized__')

        expect(codec.encode({}, procedure)).toEqual({
          status: 298,
          headers: {},
          body: '__serialized__',
        })

        expect(serializer.serialize).toHaveBeenCalledTimes(1)
        expect(serializer.serialize).toHaveBeenCalledWith(undefined)
      })

      it('works with custom status', async () => {
        serializer.serialize.mockReturnValue('__serialized__')

        const output = {
          status: 201,
          body: '__output__',
          headers: {
            'x-custom-header': 'custom-value',
          },
        }
        const response = codec.encode(output, procedure)

        expect(response).toEqual({
          status: 201,
          headers: {
            'x-custom-header': 'custom-value',
          },
          body: '__serialized__',
        })

        expect(serializer.serialize).toHaveBeenCalledTimes(1)
        expect(serializer.serialize).toHaveBeenCalledWith('__output__')
      })

      it.each([
        'invalid',
        { status: 'invalid' },
        { status: 400 },
        { status: 200.1 },
        { status: 'invalid' },
        { headers: 'invalid' },
      ])('throw on invalid output: %s', async (output) => {
        expect(() => codec.encode(output, procedure)).toThrowError()
      })
    })
  })

  describe('.encodeError', () => {
    it('works', async () => {
      serializer.serialize.mockReturnValueOnce('__serialized__')

      const error = new ORPCError('BAD_GATEWAY', {
        data: '__data__',
      })
      const response = codec.encodeError(error)

      expect(response).toEqual({
        status: error.status,
        headers: {},
        body: '__serialized__',
      })

      expect(serializer.serialize).toHaveBeenCalledOnce()
      expect(serializer.serialize).toHaveBeenCalledWith(error.toJSON(), { outputFormat: 'plain' })
    })

    it('customErrorResponseBodyEncoder', async () => {
      let time = 1
      const customErrorResponseBodyEncoder = vi.fn(() => {
        if (time++ === 2) {
          return null // default behavior
        }

        return '__custom_error_body__'
      })

      const codec = new StandardOpenAPICodec(serializer, {
        customErrorResponseBodyEncoder,
      })

      let time2 = 1
      serializer.serialize.mockImplementation(() => `__serialized${time2++}__`)

      const error1 = new ORPCError('BAD_GATEWAY', { data: '__data1__' })
      const response1 = codec.encodeError(error1)
      expect(response1).toEqual({ status: error1.status, headers: {}, body: '__serialized1__' })

      const error2 = new ORPCError('TEST_2', { data: '__data2__' })
      const response2 = codec.encodeError(error2)
      expect(response2).toEqual({ status: error2.status, headers: {}, body: '__serialized2__' })

      expect(customErrorResponseBodyEncoder).toHaveBeenCalledTimes(2)
      expect(customErrorResponseBodyEncoder).toHaveBeenNthCalledWith(1, error1)
      expect(customErrorResponseBodyEncoder).toHaveBeenNthCalledWith(2, error2)

      expect(serializer.serialize).toHaveBeenCalledTimes(2)
      expect(serializer.serialize).toHaveBeenNthCalledWith(1, '__custom_error_body__', { outputFormat: 'plain' })
      expect(serializer.serialize).toHaveBeenNthCalledWith(2, error2.toJSON(), { outputFormat: 'plain' }) // default behavior
    })
  })
})
