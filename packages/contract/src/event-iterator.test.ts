import type { AnyORPCError } from '@orpc/client'
import { ORPCError } from '@orpc/client'
import { getEventMeta, withEventMeta } from '@standardserver/core'
import * as z from 'zod'
import { ValidationError } from './error'
import { eventIterator, getEventIteratorSchemaDetails } from './event-iterator'

const ORDER_SCHEMA = z.object({ order: z.number() })

function assertValidationSuccess<T extends { issues?: unknown }>(result: T): asserts result is T & { issues: undefined } {
  if (result.issues) {
    throw new Error('Validation failed')
  }
}

describe('eventIterator', () => {
  it('expect a async iterator object', async () => {
    const schema = eventIterator(ORDER_SCHEMA)
    const result = await schema['~standard'].validate(123)
    expect(result.issues).toHaveLength(1)
  })

  it('can validate yields and preserve meta', async () => {
    const schema = eventIterator(ORDER_SCHEMA)

    const result = await schema['~standard'].validate((async function* () {
      yield { order: 1 }
      yield withEventMeta({ order: 2 }, { id: 'id-2' })
      yield { order: '3' }
    })())

    assertValidationSuccess(result)

    const first = await result.value.next()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ order: 1 })
    expect(getEventMeta(first.value)).toEqual(undefined)

    const second = await result.value.next()
    expect(second.done).toBe(false)
    expect(second.value).toEqual({ order: 2 })
    expect(getEventMeta(second.value)).toEqual({ id: 'id-2' })

    try {
      await result.value.next()
      throw new Error('Expected event iterator validation to fail')
    }
    catch (error) {
      expect(error).toBeInstanceOf(ORPCError)
      expect((error as AnyORPCError).code).toEqual('EVENT_ITERATOR_VALIDATION_FAILED')
      expect((error as AnyORPCError).cause).toBeInstanceOf(ValidationError)
      expect(((error as AnyORPCError).cause as ValidationError).issues).toHaveLength(1)
      expect(((error as AnyORPCError).cause as ValidationError).invalidData).toEqual({ order: '3' })
    }
  })

  it('can validate returns and preserve meta', async () => {
    const schema = eventIterator(ORDER_SCHEMA, ORDER_SCHEMA)

    const result = await schema['~standard'].validate((async function* () {
      return { order: 1 }
    })())

    assertValidationSuccess(result)

    const returned = await result.value.next()
    expect(returned.done).toBe(true)
    expect(returned.value).toEqual({ order: 1 })
    expect(getEventMeta(returned.value)).toEqual(undefined)
  })

  it('not required returns schema', async () => {
    const schema = eventIterator(ORDER_SCHEMA)

    const result = await schema['~standard'].validate((async function* () {
      return 'anything'
    })())

    assertValidationSuccess(result)

    await expect(result.value.next()).resolves.toEqual({ done: true, value: 'anything' })
  })

  it('cleanup origin when validation fails', async () => {
    let cleanupCalled = false
    const schema = eventIterator(ORDER_SCHEMA)

    const result = await schema['~standard'].validate((async function* () {
      try {
        yield { order: 1 }
        yield { order: '2' }
        yield { order: 3 }
      }
      finally {
        cleanupCalled = true
      }
    })())

    assertValidationSuccess(result)

    await expect(result.value.next()).resolves.toEqual({ done: false, value: { order: 1 } })
    await expect(result.value.next()).rejects.toThrow('Event iterator validation failed')
    expect(cleanupCalled).toBe(true)
  })
})

it('getEventIteratorSchemaDetails', async () => {
  const yieldSchema = ORDER_SCHEMA
  const returnSchema = ORDER_SCHEMA
  const schema = eventIterator(yieldSchema, returnSchema)

  expect(getEventIteratorSchemaDetails(schema)).toEqual({ yieldSchema, returnSchema })
  expect(getEventIteratorSchemaDetails(undefined)).toBeUndefined()
  expect(getEventIteratorSchemaDetails(z.object({}))).toBeUndefined()
})
