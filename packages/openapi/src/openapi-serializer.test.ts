import { ORPCError } from '@orpc/client'
import { isAsyncIteratorObject } from '@orpc/shared'
import { ErrorEvent } from '@standardserver/core'
import { OpenAPISerializer } from './openapi-serializer'

describe('openAPISerializer', () => {
  const serializer = new OpenAPISerializer()

  describe('serialize', () => {
    it('uses OpenAPIJsonSerializer for serialization', async () => {
      expect(await serializer.serialize({ date: new Date('2023-01-01'), count: 1n })).toEqual({
        date: '2023-01-01T00:00:00.000Z',
        count: '1',
      })
    })

    it('returns a root-level undefined as-is', async () => {
      expect(await serializer.serialize(undefined)).toBe(undefined)
    })

    it('returns a root-level Blob as-is without wrapping in FormData', async () => {
      const blob = new Blob(['hello'])
      expect(await serializer.serialize(blob)).toBe(blob)
    })

    it('returns a root-level ReadableStream as-is', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello'))
          controller.close()
        },
      })

      expect(await serializer.serialize(stream)).toBe(stream)
    })

    it('converts object with blob fields to FormData', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' })
      const result = (await serializer.serialize({ file: blob, date: new Date('2023-01-01') })) as FormData

      expect(result).toBeInstanceOf(FormData)
      const file = result.get('file') as Blob
      expect(file).toBeInstanceOf(Blob)
      expect(file.size).toBe(blob.size)
      expect(file.type).toBe(blob.type)
      expect(result.get('date')).toBe('2023-01-01T00:00:00.000Z')
    })

    it('omits null and undefined fields from FormData', async () => {
      const result = (await serializer.serialize({ file: new Blob(['data']), empty: null })) as FormData
      expect(result.has('empty')).toBe(false)
    })

    it('skips useFormDataForBlobFields when false', async () => {
      const blob = new Blob(['hello'])
      expect(await serializer.serialize({ file: blob }, { useFormDataForBlobFields: false })).not.toBeInstanceOf(FormData)
    })

    it('always returns FormData when asFormData is true, using bracket notation', async () => {
      const result = (await serializer.serialize(
        { user: { name: 'test' }, tags: ['a', 'b'] },
        { asFormData: true },
      )) as FormData

      expect(result).toBeInstanceOf(FormData)
      expect(result.get('user[name]')).toBe('test')
      expect(result.get('tags[0]')).toBe('a')
      expect(result.get('tags[1]')).toBe('b')
    })

    it('serializes root-level arrays to numeric FormData keys', async () => {
      const result = (await serializer.serialize(['a', 'b'], { asFormData: true })) as FormData

      expect(result).toBeInstanceOf(FormData)
      expect(result.get('0')).toBe('a')
      expect(result.get('1')).toBe('b')
    })

    it('call-site options override constructor defaults', async () => {
      const s = new OpenAPISerializer({ serialize: { asFormData: true, useFormDataForBlobFields: false } })

      expect(await s.serialize({ name: 'test' })).toBeInstanceOf(FormData)
      expect(await s.serialize({ name: 'test' }, { asFormData: false })).not.toBeInstanceOf(FormData)

      const blob = new Blob(['hello'])
      expect(await s.serialize({ file: blob }, { asFormData: false })).not.toBeInstanceOf(FormData)
      expect(await s.serialize({ file: blob }, { asFormData: false, useFormDataForBlobFields: true })).toBeInstanceOf(FormData)
    })

    describe('asyncIteratorObject', () => {
      async function* toAsyncIter<T>(values: T[]) {
        for (const v of values) yield v
      }

      it('returns an AsyncIteratorObject and serializes yielded values', async () => {
        const result = (await serializer.serialize(toAsyncIter([new Date('2023-01-01'), 42n]))) as AsyncIteratorObject<unknown>
        expect(result).toSatisfy(isAsyncIteratorObject)

        const collected: unknown[] = []
        for await (const v of result) collected.push(v)
        expect(collected).toEqual(['2023-01-01T00:00:00.000Z', '42'])
      })

      it('passes through undefined yielded values as-is', async () => {
        const result = (await serializer.serialize(toAsyncIter([undefined, 'value']))) as AsyncIteratorObject<unknown>
        expect(result).toSatisfy(isAsyncIteratorObject)

        const collected: unknown[] = []
        for await (const v of result) collected.push(v)
        expect(collected).toEqual([undefined, 'value'])
      })

      it('ignores asFormData default option and never wraps yielded values', async () => {
        const s = new OpenAPISerializer({ serialize: { asFormData: true } })
        const result = (await s.serialize(toAsyncIter([{ name: 'test' }]))) as AsyncIteratorObject<unknown>
        expect(result).toSatisfy(isAsyncIteratorObject)

        const collected: unknown[] = []
        for await (const v of result) collected.push(v)
        expect(collected).toEqual([{ name: 'test' }])
      })

      it('converts thrown ORPC errors into ErrorEvent payloads', async () => {
        const error = new ORPCError('BAD_GATEWAY', { data: { reason: 'upstream' } })
        const result = (await serializer.serialize((async function* () {
          throw error
        })())) as AsyncIteratorObject<unknown>

        await expect(result.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ErrorEvent)
          expect(e.data).toEqual({
            cause: error,
            data: error.toJSON(),
          })

          return true
        })
      })

      it('maps unknown iterator errors into INTERNAL_SERVER_ERROR payloads', async () => {
        const error = new Error('unexpected')
        const result = (await serializer.serialize((async function* () {
          throw error
        })())) as AsyncIteratorObject<unknown>

        await expect(result.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ErrorEvent)
          expect(e.data).toMatchObject({
            cause: error,
            data: {
              code: 'INTERNAL_SERVER_ERROR',
              defined: false,
              inferable: false,
              message: 'Internal Server Error',
            },
          })

          return true
        })
      })
    })
  })

  describe('deserialize', () => {
    it('uses OpenAPIJsonSerializer for deserialization', () => {
      expect(serializer.deserialize({ name: 'test', value: 42 })).toEqual({ name: 'test', value: 42 })
    })

    it.each([
      ['URLSearchParams', () => new URLSearchParams('user[name]=test&tags[0]=a&tags[1]=b')],
      ['FormData', () => {
        const f = new FormData()
        f.append('user[name]', 'test')
        f.append('tags[0]', 'a')
        f.append('tags[1]', 'b')
        return f
      }],
    ])('deserializes %s using bracket notation', (_, makeInput) => {
      const result = serializer.deserialize(makeInput()) as any
      expect(result.user.name).toBe('test')
      expect(result.tags).toEqual(['a', 'b'])
    })

    it('deserializes root-level numeric bracket notation as an object', () => {
      const result = serializer.deserialize(new URLSearchParams('0=a&1=b')) as any

      expect(Array.isArray(result)).toBe(false)
      expect(result).toEqual({
        0: 'a',
        1: 'b',
      })
    })

    it('deserializes FormData blob fields', () => {
      const blob = new Blob(['hello'], { type: 'text/plain' })
      const form = new FormData()
      form.append('file', blob)
      const result = serializer.deserialize(form) as any
      expect(result.file).toBeInstanceOf(Blob)
      expect(result.file.size).toBe(blob.size)
      expect(result.file.type).toBe(blob.type)
    })

    it('returns undefined bodies as-is', () => {
      expect(serializer.deserialize(undefined)).toBe(undefined)
    })

    it('returns Blob bodies as-is', () => {
      const blob = new Blob(['hi'])
      expect(serializer.deserialize(blob)).toBe(blob)
    })

    it('returns ReadableStream bodies as-is', () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello'))
          controller.close()
        },
      })

      expect(serializer.deserialize(stream)).toBe(stream)
    })

    describe('asyncIteratorObject', () => {
      async function* toAsyncIter<T>(values: T[]) {
        for (const v of values) yield v
      }

      it('returns an AsyncIteratorObject and passes through yielded values', async () => {
        const result = (await serializer.deserialize(toAsyncIter([{ a: 1 }, { b: 2 }]))) as AsyncIterable<unknown>
        expect(result).toSatisfy(isAsyncIteratorObject)

        const collected: unknown[] = []
        for await (const v of result) collected.push(v)
        expect(collected).toEqual([{ a: 1 }, { b: 2 }])
      })

      it('passes through undefined yielded values as-is', async () => {
        const result = (await serializer.deserialize(toAsyncIter([undefined, { a: 1 }]))) as AsyncIterable<unknown>
        expect(result).toSatisfy(isAsyncIteratorObject)

        const collected: unknown[] = []
        for await (const v of result) collected.push(v)
        expect(collected).toEqual([undefined, { a: 1 }])
      })

      it('converts ErrorEvent ORPC payloads back into ORPCError instances', async () => {
        const error = new ErrorEvent(
          new ORPCError('BAD_GATEWAY', { data: { reason: 'upstream' } }).toJSON(),
        )
        const result = (await serializer.deserialize((async function* () {
          throw error
        })())) as AsyncIteratorObject<unknown>

        await expect(result.next()).rejects.toSatisfy((e: any) => {
          expect(e).toBeInstanceOf(ORPCError)
          expect(e.code).toBe('BAD_GATEWAY')
          expect(e.data).toEqual({ reason: 'upstream' })
          expect(e.cause).toBe(error)

          return true
        })
      })

      it('passes through ErrorEvent instances with non-ORPC payloads', async () => {
        const error = new ErrorEvent({ reason: 'upstream' })
        const result = (await serializer.deserialize((async function* () {
          throw error
        })())) as AsyncIteratorObject<unknown>

        await expect(result.next()).rejects.toBe(error)
      })

      it('passes through non-ErrorEvent errors', async () => {
        const error = new Error('unexpected')
        const result = (await serializer.deserialize((async function* () {
          throw error
        })())) as AsyncIteratorObject<unknown>

        await expect(result.next()).rejects.toBe(error)
      })
    })
  })

  describe('options', () => {
    it('passes OpenAPIJsonSerializerOptions to OpenAPIJsonSerializer', async () => {
      const s = new OpenAPISerializer({
        handlers: {
          date: {
            condition: v => v instanceof Date,
            serialize: (v: Date) => `___TEST___${v.getTime()}`,
          },
          cryptoKey: {
            condition: v => v instanceof CryptoKey,
            serialize: async (v: CryptoKey) => {
              return await crypto.subtle.exportKey('jwk', v)
            },
          },
        },
      })

      const date = new Date('2023-01-01')
      expect((await s.serialize({ value: date }))).toEqual({ value: `___TEST___${date.getTime()}` })

      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      )
      const serialized = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
      expect((await s.serialize({ value: keyPair.publicKey }))).toEqual({ value: serialized })
    })

    it('passes omitUndefinedProperties to OpenAPIJsonSerializer', async () => {
      const s = new OpenAPISerializer({ omitUndefinedProperties: false })
      expect((await s.serialize({ a: 1, b: undefined }))).toEqual({ a: 1, b: null })
    })

    it('passes BracketNotationSerializerOptions to BracketNotationSerializer', async () => {
      const s = new OpenAPISerializer({ bracketNotation: { maxExplicitDeserializingArrayIndex: 0 } })

      // index 1 exceeds the limit of 0, so the array should be deserialized as an object
      const form = new FormData()
      form.append('tags[0]', 'a')
      form.append('tags[1]', 'b')
      const result = await s.deserialize(form) as any
      expect(Array.isArray(result.tags)).toBe(false)
      expect(result.tags['0']).toBe('a')
      expect(result.tags['1']).toBe('b')
    })
  })
})
