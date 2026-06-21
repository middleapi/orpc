import { isAsyncIteratorObject, parseEmptyableJSON } from '@orpc/shared'
import { ErrorEvent, getEventMeta, withEventMeta } from '@standardserver/core'
import { builtInRPCSupportDataTypes } from '../../../tests/rpc/__shared__/built-in-support-data-types'
import { ORPCError } from './error'
import { RPCSerializer } from './rpc-serializer'

describe('rpcSerializer', () => {
  describe.each(builtInRPCSupportDataTypes)('$name', ({ value, expected }) => {
    const serializer = new RPCSerializer()

    function serializeAndDeserialize(value: unknown): unknown {
      const serialized = serializer.serialize(value)

      if (serialized instanceof FormData || serialized instanceof Blob) {
        return serializer.deserialize(serialized)
      }

      return serializer.deserialize(parseEmptyableJSON(JSON.stringify(serialized) ?? '')) // like in the real world
    }

    it('should work on flat', async () => {
      expect(
        serializeAndDeserialize(value),
      ).toEqual(
        expected,
      )
    })

    it('should work on nested object', async () => {
      expect(
        serializeAndDeserialize({
          data: value,
        }),
      ).toEqual(
        {
          data: expected,
        },
      )
    })

    it('should work on complex object', async () => {
      expect(
        serializeAndDeserialize({
          '!@#$%^^&()[]>?<~_<:"~+!_': value,
          'list': [value],
          'map': new Map([[value, value]]),
          'set': new Set([value]),
          'nested': {
            nested: value,
          },
        }),
      ).toEqual({
        '!@#$%^^&()[]>?<~_<:"~+!_': expected,
        'list': [expected],
        'map': new Map([[expected, expected]]),
        'set': new Set([expected]),
        'nested': {
          nested: expected,
        },
      })
    })
  })

  describe('event iterator', async () => {
    const serializer = new RPCSerializer()

    function serializeAndDeserialize(value: unknown): unknown {
      const serialized = serializer.serialize(value)
      return serializer.deserialize(serialized)
    }

    const date = new Date()

    it('on success', async () => {
      const iterator = (async function* () {
        yield 1
        yield withEventMeta({ order: 2, date }, { retry: 1000 })
        return withEventMeta({ order: 3 }, { id: '123456' })
      })()

      const deserialized = serializeAndDeserialize(iterator) as any

      expect(deserialized).toSatisfy(isAsyncIteratorObject)
      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual(1)
        expect(getEventMeta(value)).toEqual(undefined)

        return true
      })

      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual({ order: 2, date })
        expect(getEventMeta(value)).toEqual({ retry: 1000 })

        return true
      })

      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(true)
        expect(value).toEqual({ order: 3 })
        expect(getEventMeta(value)).toEqual({ id: '123456' })

        return true
      })
    })

    it('passes through undefined yielded values as is', async () => {
      const iterator = (async function* () {
        yield undefined
        return 'done'
      })()

      const deserialized = serializeAndDeserialize(iterator) as any

      expect(deserialized).toSatisfy(isAsyncIteratorObject)
      await expect(deserialized.next()).resolves.toEqual({ value: undefined, done: false })
      await expect(deserialized.next()).resolves.toEqual({ value: 'done', done: true })
    })

    it('on error with ORPCError', async () => {
      const error = withEventMeta(new ORPCError('BAD_GATEWAY', { data: { order: 3 } }), { id: '123456' })

      const iterator = (async function* () {
        yield 1
        yield withEventMeta({ order: 2, date }, { retry: 1000 })
        throw error
      })()

      const deserialized = serializeAndDeserialize(iterator) as any

      expect(deserialized).toSatisfy(isAsyncIteratorObject)
      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual(1)
        expect(getEventMeta(value)).toEqual(undefined)

        return true
      })

      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual({ order: 2, date })
        expect(getEventMeta(value)).toEqual({ retry: 1000 })

        return true
      })

      await expect(deserialized.next()).rejects.toSatisfy((e: any) => {
        expect(e).toEqual(error)
        expect(e).toBeInstanceOf(ORPCError)
        expect(e.cause).toBeInstanceOf(ErrorEvent)

        return true
      })
    })

    it('on error with unknown error when deserialize', async () => {
      const error = withEventMeta(new Error('UNKNOWN'), { id: '123456' })

      const iterator = (async function* () {
        yield serializer.serialize(1)
        yield withEventMeta(serializer.serialize({ order: 2, date }) as any, { retry: 1000 })
        throw error
      })()

      const deserialized = serializer.deserialize(iterator as any) as any

      expect(deserialized).toSatisfy(isAsyncIteratorObject)
      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual(1)
        expect(getEventMeta(value)).toEqual(undefined)

        return true
      })

      await expect(deserialized.next()).resolves.toSatisfy(({ value, done }) => {
        expect(done).toBe(false)
        expect(value).toEqual({ order: 2, date })
        expect(getEventMeta(value)).toEqual({ retry: 1000 })

        return true
      })

      await expect(deserialized.next()).rejects.toBe(error)
    })

    it('deserialize an invalid ORPCError json', async () => {
      const iterator = serializer.deserialize((async function* () {
        throw new ErrorEvent({ json: { value: 1234 } })
      })()) as any

      await expect(iterator.next()).rejects.toSatisfy((e: any) => {
        expect(e).toBeInstanceOf(ErrorEvent)
        expect(e.data).toEqual({ value: 1234 })

        return true
      })
    })
  })

  describe('readable stream & blob', () => {
    it('should serialize and deserialize ReadableStream as is', () => {
      const serializer = new RPCSerializer()

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('test')
          controller.close()
        },
      })

      const serialized = serializer.serialize(stream)
      expect(serialized).toBe(stream)

      const deserialized = serializer.deserialize(serialized)
      expect(deserialized).toBe(stream)
    })

    it('should serialize and deserialize Blob as is', () => {
      const serializer = new RPCSerializer()

      const blob = new Blob(['test'], { type: 'text/plain' })

      const serialized = serializer.serialize(blob)
      expect(serialized).toBe(blob)

      const deserialized = serializer.deserialize(serialized)
      expect(deserialized).toBe(blob)
    })

    it('should serialize and deserialize undefined as is', () => {
      const serializer = new RPCSerializer()

      const serialized = serializer.serialize(undefined)
      expect(serialized).toBe(undefined)

      const deserialized = serializer.deserialize(serialized)
      expect(deserialized).toBe(undefined)
    })
  })

  describe('constructor', () => {
    it('should passing options to RPCJsonSerializer', () => {
      const serializer = new RPCSerializer({
        handlers: {
          date: {
            condition: (data: unknown): boolean => data instanceof Date,
            serialize: (date: Date) => `__TEST_DATE__${date.toISOString()}`,
            deserialize: (isoString: string) => new Date(isoString.replace('__TEST_DATE__', '')),
          },
        },
      })

      const date = new Date('2023-01-01')
      const serialized = serializer.serialize(date)
      expect((serialized as any).json).toBe(`__TEST_DATE__${date.toISOString()}`)
    })
  })

  describe('useFormDataForBlobFields option', () => {
    it('should respect the useFormDataForBlobFields option in the constructor', () => {
      const serializer = new RPCSerializer({
        serialize: { useFormDataForBlobFields: false },
      })

      const blob = new Blob(['test'], { type: 'text/plain' })
      const serialized = serializer.serialize({ blob })

      expect(serialized).not.toBeInstanceOf(FormData)
    })

    it('should respect the useFormDataForBlobFields option in the serialize method', () => {
      const serializer = new RPCSerializer()

      const blob = new Blob(['test'], { type: 'text/plain' })
      const serialized = serializer.serialize({ blob }, { useFormDataForBlobFields: false })

      expect(serialized).not.toBeInstanceOf(FormData)
    })

    it('should prefer serialize option over constructor option', () => {
      const serializer = new RPCSerializer({ serialize: { useFormDataForBlobFields: false } })

      const blob = new Blob(['test'], { type: 'text/plain' })
      const serialized = serializer.serialize({ blob }, { useFormDataForBlobFields: true })

      expect(serialized).toBeInstanceOf(FormData)
    })
  })
})
