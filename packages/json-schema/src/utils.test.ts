import type { JsonSchema } from './types'
import { ensureJsonSchemaObject, isJsonArraySchema, isJsonFileSchema, isJsonObjectSchema, isUnconstrainedSchema } from './utils'

it('isJsonFileSchema', () => {
  expect(isJsonFileSchema({ type: 'string', contentMediaType: 'image/png' })).toBe(true)
  expect(isJsonFileSchema({ type: 'string', format: 'binary' })).toBe(true)
  expect(isJsonFileSchema({ type: 'string', format: 'binary' })).toBe(true)
  expect(isJsonFileSchema({ type: 'string', contentEncoding: 'binary' })).toBe(true)

  expect(isJsonFileSchema({ type: 'string' })).toBe(false)
  expect(isJsonFileSchema({ type: 'object', contentMediaType: 'image/png' })).toBe(false)
  expect(isJsonFileSchema({ type: 'object', format: 'binary' })).toBe(false)
  expect(isJsonFileSchema({ type: 'object', contentEncoding: 'binary' })).toBe(false)
  expect(isJsonFileSchema(true)).toBe(false)
})

it('isJsonObjectSchema', () => {
  expect(isJsonObjectSchema({ type: 'object' })).toBe(true)

  expect(isJsonObjectSchema({ type: 'array' })).toBe(false)
  expect(isJsonObjectSchema(false)).toBe(false)
})

it('isJsonArraySchema', () => {
  expect(isJsonArraySchema({ type: 'array' })).toBe(true)

  expect(isJsonArraySchema({ type: 'object' })).toBe(false)
  expect(isJsonArraySchema(false)).toBe(false)
})

it('isUnconstrainedSchema', () => {
  expect(isUnconstrainedSchema(true)).toBe(true)
  expect(isUnconstrainedSchema(false)).toBe(false)
  expect(isUnconstrainedSchema({})).toBe(true)
  expect(isUnconstrainedSchema({ description: 'metadata only' })).toBe(true)

  expect(isUnconstrainedSchema({ type: 'string' })).toBe(false)
  expect(isUnconstrainedSchema({ properties: { a: { type: 'string' } } })).toBe(false)
})

describe('ensureJsonSchemaObject', () => {
  it('normalizes booleans and preserves object schemas', () => {
    const objectSchema: JsonSchema = { type: 'string' }

    expect(ensureJsonSchemaObject(true)).toEqual({})
    expect(ensureJsonSchemaObject(false)).toEqual({ not: {} })
    expect(ensureJsonSchemaObject(objectSchema)).toBe(objectSchema)
  })
})
