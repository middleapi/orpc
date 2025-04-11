import { ORPCError } from '@orpc/client'
import { getEventMeta, withEventMeta } from '@orpc/standard-server'
import { z } from 'zod'
import { ValidationError } from './error'
import { eventIterator, getEventIteratorSchemaDetails } from './event-iterator'

describe('eventIterator', async () => {
  it('expect a async iterator object', async () => {
    const schema = eventIterator(z.object({ order: z.number() }))
    const result = await schema['~standard'].validate(123)
    expect(result.issues).toHaveLength(1)
  })

  it('can validate yields', async () => {
    const schema = eventIterator(z.object({ order: z.number() }))

    const result = await schema['~standard'].validate((async function* () {
      yield { order: 1 }
      yield withEventMeta({ order: 2 }, { id: 'id-2' })
      yield { order: '3' }
    })())

    if (result.issues) {
      throw new Error('Validation failed')
    }

    await expect(result.value.next()).resolves.toSatisfy(({ done, value }) => {
      expect(done).toBe(false)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(undefined)

      return true
    })

    await expect(result.value.next()).resolves.toSatisfy(({ done, value }) => {
      expect(done).toBe(false)
      expect(value).toEqual({ order: 2 })
      expect(getEventMeta(value)).toEqual({ id: 'id-2' })

      return true
    })

    await expect(result.value.next()).rejects.toSatisfy((e) => {
      expect(e).toBeInstanceOf(ORPCError)
      expect(e.code).toEqual('EVENT_ITERATOR_VALIDATION_FAILED')
      expect(e.cause).toBeInstanceOf(ValidationError)
      expect(e.cause.issues).toHaveLength(1)

      return true
    })
  })

  it('can validate returns', async () => {
    const schema = eventIterator(z.object({ order: z.number() }), z.object({ order: z.number() }))

    const result = await schema['~standard'].validate((async function* () {
      return { order: 1 }
    })())

    if (result.issues) {
      throw new Error('Validation failed')
    }

    await expect(result.value.next()).resolves.toSatisfy(({ done, value }) => {
      expect(done).toBe(true)
      expect(value).toEqual({ order: 1 })
      expect(getEventMeta(value)).toEqual(undefined)

      return true
    })
  })

  it('not required returns schema', async () => {
    const schema = eventIterator(z.object({ order: z.number() }))

    const result = await schema['~standard'].validate((async function* () {
      return 'anything'
    })())

    if (result.issues) {
      throw new Error('Validation failed')
    }

    await expect(result.value.next()).resolves.toSatisfy(({ done, value }) => {
      expect(done).toBe(true)
      expect(value).toEqual('anything')

      return true
    })
  })
})

it('getEventIteratorSchemaDetails', async () => {
  const yieldSchema = z.object({ order: z.number() })
  const returnSchema = z.object({ order: z.number() })
  const schema = eventIterator(yieldSchema, returnSchema)

  expect(getEventIteratorSchemaDetails(schema)).toEqual({ yields: yieldSchema, returns: returnSchema })
  expect(getEventIteratorSchemaDetails(undefined)).toBeUndefined()
  expect(getEventIteratorSchemaDetails(z.object({}))).toBeUndefined()
})
