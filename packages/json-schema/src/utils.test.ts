import type { JsonSchema } from './types'
import { containsJsonFileSchema, ensureJsonSchemaObject, isJsonArraySchema, isJsonFileSchema, isJsonObjectSchema, isJsonPrimitiveSchema, isUnconstrainedSchema } from './utils'

it('isJsonPrimitiveSchema', () => {
  expect(isJsonPrimitiveSchema({ type: 'string' })).toBe(true)
  expect(isJsonPrimitiveSchema({ const: 'fixed' })).toBe(true)
  expect(isJsonPrimitiveSchema({ enum: ['a', 'b'] })).toBe(true)

  expect(isJsonPrimitiveSchema(true)).toBe(false)
  expect(isJsonPrimitiveSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBe(false)
  expect(isJsonPrimitiveSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })).toBe(false)

  // does not support union - need manually flattenJsonUnionSchema.every
  expect(isJsonPrimitiveSchema({ description: 'primitive union', anyOf: [{ type: 'number' }, { oneOf: [{ type: 'boolean' }, { const: 'x' }] }] })).toBe(false)
})

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

it('containsJsonFileSchema', () => {
  expect(containsJsonFileSchema({ type: 'string', contentMediaType: 'image/png' })).toBe(true)
  expect(containsJsonFileSchema({ type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } })).toBe(true)
  expect(containsJsonFileSchema({ type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string', contentEncoding: 'binary' }] } })).toBe(true)
  expect(containsJsonFileSchema({ $ref: '#/$defs/File', $defs: { File: { type: 'string', contentMediaType: '*/*' } } })).toBe(true)

  expect(containsJsonFileSchema({ type: 'object', properties: { name: { type: 'string' } } })).toBe(false)
  expect(containsJsonFileSchema(true)).toBe(false)
})

it('containsJsonFileSchema follows only reachable refs', () => {
  const $defs: Record<string, JsonSchema> = {
    File: { type: 'string', contentMediaType: '*/*' },
    WithFile: { type: 'object', properties: { file: { $ref: '#/$defs/File' } } },
    Tree: { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/Tree' } } } },
    TreeWithFile: { type: 'object', properties: { file: { $ref: '#/$defs/File' }, children: { type: 'array', items: { $ref: '#/$defs/TreeWithFile' } } } },
  }

  expect(containsJsonFileSchema({ type: 'object', properties: { id: { type: 'string' } }, $defs })).toBe(false)
  expect(containsJsonFileSchema({ $ref: '#/$defs/Tree', $defs })).toBe(false)

  expect(containsJsonFileSchema({ type: 'object', properties: { nested: { $ref: '#/$defs/WithFile' } }, $defs })).toBe(true)
  expect(containsJsonFileSchema({ anyOf: [{ $ref: '#/$defs/Tree' }, { $ref: '#/$defs/TreeWithFile' }], $defs })).toBe(true)
  expect(containsJsonFileSchema({ type: 'object', properties: { file: { $ref: '#/$defs/WithFile/properties/file' } }, $defs })).toBe(true)

  expect(containsJsonFileSchema({ type: 'object', properties: { self: { $ref: '#' } } })).toBe(false)
  expect(containsJsonFileSchema({ type: 'object', properties: { self: { $ref: '#' }, file: { type: 'string', format: 'binary' } } })).toBe(true)

  expect(containsJsonFileSchema({ $ref: '#/$defs/Missing', $defs })).toBe(false)

  expect(containsJsonFileSchema({ type: 'object', default: { type: 'string', format: 'binary' } })).toBe(false)
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
