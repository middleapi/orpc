import { ORPCError } from '@orpc/contract'
import { isObject } from '@orpc/shared'
import { ErrorEvent, getEventMeta, withEventMeta } from '@orpc/standard-server'
import { StandardBracketNotationSerializer } from './bracket-notation'
import { StandardOpenAPIJsonSerializer } from './openapi-json-serializer'
import { StandardOpenAPISerializer } from './openapi-serializer'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('standardOpenAPIJsonSerializer', () => {
  const jsonSerializer = new StandardOpenAPIJsonSerializer()
  const serialize = vi.fn(v => jsonSerializer.serialize(v))

  const openapiSerializer = new StandardOpenAPISerializer({
    serialize,
  } as any, new StandardBracketNotationSerializer())

  describe('.serialize', () => {
    it('with undefined', () => {
      expect(openapiSerializer.serialize(undefined)).toBeUndefined()
    })

    it('with blob', () => {
      const blob = new Blob([])
      expect(openapiSerializer.serialize(blob)).toBe(blob)
    })

    it('with data', () => {
      const data = {
        date: new Date(),
        number: 123,
        nested: {
          date: new Date(),
        },
      }

      expect(openapiSerializer.serialize(data)).toBe(
        serialize.mock.results[0]!.value[0],
      )

      expect(serialize).toHaveBeenCalledOnce()
      expect(serialize).toHaveBeenCalledWith(data)
    })

    it('with data and blobs', async () => {
      const data = {
        date: new Date(),
        number: 123,
        nested: {
          date: new Date(),
        },
        blob: new Blob(['hello'], { type: 'text/plain' }),
      }

      const serialized = openapiSerializer.serialize(data)

      expect(serialized).toBeInstanceOf(FormData)
      expect((serialized as any).get('date')).toBe(data.date.toISOString())
      expect((serialized as any).get('number')).toBe(data.number.toString())
      expect((serialized as any).get('nested[date]')).toBe(data.nested.date.toISOString())
      expect((serialized as any).get('blob')).toBeInstanceOf(Blob)
      expect((serialized as any).get('blob').type).toBe('text/plain')
      expect(await (serialized as any).get('blob').text()).toBe('hello')

      expect(serialize).toHaveBeenCalledOnce()
      expect(serialize).toHaveBeenCalledWith(data)
    })

    describe('with event iterator', async () => {
      it('on success', async () => {
        const date = new Date()
        const blob = new Blob(['hi'])

        const serialized = openapiSerializer.serialize((async function* () {
          yield 1
          yield withEventMeta({ order: 2, date }, { retry: 1000 })
          return withEventMeta({ order: 3, blob }, { id: '123456' })
        })()) as any

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toBe(serialize.mock.results[0]!.value[0])
          expect(getEventMeta(value)).toEqual(undefined)

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith(1)
        serialize.mockClear()

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual(serialize.mock.results[0]!.value[0])
          expect(getEventMeta(value)).toEqual({ retry: 1000 })

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith({ order: 2, date })
        serialize.mockClear()

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(true)
          expect(value).toEqual(serialize.mock.results[0]!.value[0])
          expect(getEventMeta(value)).toEqual({ id: '123456' })

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith({ order: 3, blob })
        serialize.mockClear()
      })

      it('on error with ORPCError', async () => {
        const blob = new Blob(['hi'])
        const error = withEventMeta(new ORPCError('BAD_GATEWAY', { data: { order: 3 } }), { id: '123456' })

        const serialized = openapiSerializer.serialize((async function* () {
          yield 1
          yield withEventMeta({ order: 2, blob }, { retry: 1000 })
          throw error
        })()) as any

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toBe(serialize.mock.results[0]!.value[0])
          expect(getEventMeta(value)).toEqual(undefined)

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith(1)
        serialize.mockClear()

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual(serialize.mock.results[0]!.value[0])
          expect(getEventMeta(value)).toEqual({ retry: 1000 })

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith({ order: 2, blob })
        serialize.mockClear()

        await expect(serialized.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ErrorEvent)
          expect(e.data).toEqual(serialize.mock.results[0]!.value[0])
          expect(e.cause).toBe(error)
          expect(getEventMeta(e)).toEqual({ id: '123456' })

          return true
        })

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_GATEWAY', data: { order: 3 } }))
        serialize.mockClear()
      })
    })

    describe('outputFormat: URLSearchParams', async () => {
      it('works', () => {
        const data = {
          a: 1,
          b: true,
          nested: {
            c: [new Date()],
          },
          blob: new Blob(['hi']),
        }

        const serialized = openapiSerializer.serialize(data, { outputFormat: 'URLSearchParams' }) as URLSearchParams

        expect(serialized).toBeInstanceOf(URLSearchParams)
        expect(serialized.get('a')).toBe('1')
        expect(serialized.get('b')).toBe('true')
        expect(serialized.get('nested[c][0]')).toBe(data.nested.c[0]!.toISOString())
        expect(serialized.get('nested[blob]')).toBe(null)

        expect(serialize).toHaveBeenCalledOnce()
        expect(serialize).toHaveBeenCalledWith(data)
      })

      it('with undefined at root', () => {
        const serialized = openapiSerializer.serialize(undefined, { outputFormat: 'URLSearchParams' }) as URLSearchParams

        expect([...serialized.entries()]).toEqual([])
      })
    })

    it('outputFormat: plain', async () => {
      const data = {
        a: 1,
        b: true,
        nested: {
          c: [new Date()],
        },
      }

      const serialized = openapiSerializer.serialize(data, { outputFormat: 'plain' })

      expect(serialized).toBe(serialize.mock.results[0]!.value[0])

      expect(serialize).toHaveBeenCalledOnce()
      expect(serialize).toHaveBeenCalledWith(data)
    })
  })

  describe('.deserialize', () => {
    it('with undefined', () => {
      expect(openapiSerializer.deserialize(undefined)).toBeUndefined()
    })

    it('with blob', () => {
      const blob = new Blob([])
      expect(openapiSerializer.deserialize(blob)).toBe(blob)
    })

    it('with data', () => {
      const data = {
        date: new Date(),
        number: 123,
        nested: {
          date: new Date(),
        },
      }
      expect(openapiSerializer.deserialize(data)).toBe(data)
    })

    it('with formdata', async () => {
      const data = {
        date: new Date(),
        number: 123,
        nested: {
          date: new Date(),
        },
        blob: new Blob(['hello'], { type: 'text/plain' }),
      }

      const serialized = new FormData()
      serialized.append('date', data.date.toString())
      serialized.append('number', data.number.toString())
      serialized.append('nested[date]', data.nested.date.toString())
      serialized.append('blob', data.blob)

      const deserialized = openapiSerializer.deserialize(serialized)

      expect(deserialized).toSatisfy(isObject)
      expect(deserialized).toEqual({
        date: data.date.toString(),
        number: data.number.toString(),
        nested: {
          date: data.nested.date.toString(),
        },
        blob: expect.any(File),
      })

      expect((deserialized as any).blob.name).toBe('blob')
      expect((deserialized as any).blob.type).toBe('text/plain')
      expect(await (deserialized as any).blob.text()).toBe('hello')
    })

    it('with URLSearchParams', async () => {
      const data = {
        date: new Date().toString(),
        nested: {
          date: new Date().toString(),
        },
      }

      const serialized = new URLSearchParams()
      serialized.append('date', data.date)
      serialized.append('nested[date]', data.nested.date)

      const deserialized = openapiSerializer.deserialize(serialized)

      expect(deserialized).toSatisfy(isObject)
      expect(deserialized).toEqual(data)
    })

    describe('with event iterator', async () => {
      it('on success', async () => {
        const date = new Date()

        const serialized = openapiSerializer.deserialize((async function* () {
          yield 1
          yield withEventMeta({ order: 2, date }, { retry: 1000 })
          return withEventMeta({ order: 3 }, { id: '123456' })
        })()) as any

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual(1)
          expect(getEventMeta(value)).toEqual(undefined)

          return true
        })

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual({ order: 2, date })
          expect(getEventMeta(value)).toEqual({ retry: 1000 })

          return true
        })

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(true)
          expect(value).toEqual({ order: 3 })
          expect(getEventMeta(value)).toEqual({ id: '123456' })

          return true
        })
      })

      it('on error has valid ORPCError format', async () => {
        const date = new Date()
        const error = withEventMeta(new ErrorEvent({
          data: new ORPCError('BAD_GATEWAY', { data: { order: 3 } }).toJSON(),
        }), { id: '123456' })

        const serialized = openapiSerializer.deserialize((async function* () {
          yield 1
          yield withEventMeta({ order: 2, date }, { retry: 1000 })
          throw error
        })()) as any

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual(1)
          expect(getEventMeta(value)).toEqual(undefined)

          return true
        })

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual({ order: 2, date })
          expect(getEventMeta(value)).toEqual({ retry: 1000 })

          return true
        })

        await expect(serialized.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ORPCError)
          expect(e.code).toBe('BAD_GATEWAY')
          expect(e.data).toEqual({ order: 3 })
          expect(e.cause).toBe(error)
          expect(getEventMeta(e)).toEqual({ id: '123456' })

          return true
        })
      })

      it('on error has ORPCError format without status (OpenAPIHandler v2)', async () => {
        const error = new ErrorEvent({
          data: { defined: false, code: 'NOT_FOUND', message: 'message', data: { order: 3 } },
        })

        const serialized = openapiSerializer.deserialize((async function* () {
          throw error
        })()) as any

        await expect(serialized.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ORPCError)
          expect(e.code).toBe('NOT_FOUND')
          expect(e.status).toBe(404)
          expect(e.message).toBe('message')
          expect(e.data).toEqual({ order: 3 })
          expect(e.cause).toBe(error)

          return true
        })
      })

      it('on error has invalid ORPCError format', async () => {
        const date = new Date()
        const error = withEventMeta(new ErrorEvent({
          data: { order: 3 },
        }), { id: '123456' })

        const serialized = openapiSerializer.deserialize((async function* () {
          yield 1
          yield withEventMeta({ order: 2, date }, { retry: 1000 })
          throw error
        })()) as any

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual(1)
          expect(getEventMeta(value)).toEqual(undefined)

          return true
        })

        await expect(serialized.next()).resolves.toSatisfy(({ value, done }) => {
          expect(done).toBe(false)
          expect(value).toEqual({ order: 2, date })
          expect(getEventMeta(value)).toEqual({ retry: 1000 })

          return true
        })

        await expect(serialized.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBe(error)

          return true
        })
      })
    })
  })
})
