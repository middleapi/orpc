import type { JSONSchema, ObjectSchema } from './schema'
import { isObject } from '@orpc/shared'
import {
  applySchemaOptionality,
  expandArrayableSchema,
  expandUnionSchema,
  filterSchemaBranches,
  isAnySchema,
  isFileSchema,
  isNeverSchema,
  isObjectSchema,
  isPrimitiveSchema,
  separateObjectSchema,
} from './schema-utils'

it('isFileSchema', () => {
  expect(isFileSchema({ type: 'string', contentMediaType: 'image/png' })).toBe(true)
  expect(isFileSchema({ type: 'string', contentMediaType: 'image/png', examples: ['image.png'] })).toBe(true)

  expect(isFileSchema({ type: 'object', contentMediaType: 'image/png' })).toBe(false)
  expect(isFileSchema(true)).toBe(false)
  expect(isFileSchema(false)).toBe(false)
})

it('isObjectSchema', () => {
  expect(isObjectSchema({ type: 'object' })).toBe(true)
  expect(isObjectSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBe(true)

  expect(isObjectSchema({ type: 'string' })).toBe(false)
  expect(isObjectSchema(true)).toBe(false)
  expect(isObjectSchema(false)).toBe(false)
})

it('isAnySchema', () => {
  expect(isAnySchema(true)).toBe(true)
  expect(isAnySchema(false)).toBe(true)
  expect(isAnySchema({})).toBe(true)
  expect(isAnySchema({ type: 'string' })).toBe(false)
  expect(isAnySchema({ description: 'description' })).toBe(true)
  expect(isAnySchema({ properties: undefined, required: undefined })).toBe(true)
})

describe('isNeverSchema', () => {
  describe('returns true for never schemas', () => {
    it('returns true for boolean false', () => {
      expect(isNeverSchema(false)).toBe(true)
    })

    it('returns true for { not: true }', () => {
      expect(isNeverSchema({ not: true })).toBe(true)
    })

    it('returns true for { not: {} }', () => {
      expect(isNeverSchema({ not: {} })).toBe(true)
    })
  })

  describe('returns false for non-never schemas', () => {
    it('returns false for boolean true', () => {
      expect(isNeverSchema(true)).toBe(false)
    })

    it('returns false for an empty schema {}', () => {
      expect(isNeverSchema({})).toBe(false)
    })

    it('returns false for a type constraint', () => {
      expect(isNeverSchema({ type: 'string' })).toBe(false)
    })

    it('returns false for { not: false } (double negation = always true)', () => {
      expect(isNeverSchema({ not: false })).toBe(false)
    })

    it('returns false for { not: { type: \'string\' } } (only rejects strings)', () => {
      expect(isNeverSchema({ not: { type: 'string' } })).toBe(false)
    })

    it('returns false for a schema with only additionalProperties', () => {
      expect(isNeverSchema({ additionalProperties: false })).toBe(false)
    })

    it('returns false for a complex schema', () => {
      expect(
        isNeverSchema({
          type: 'object',
          properties: { id: { type: 'number' } },
          required: ['id'],
        }),
      ).toBe(false)
    })
  })
})

describe('separateObjectSchema', () => {
  it('separate', () => {
    const schema: ObjectSchema = {
      type: 'object',
      description: 'description',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a', 'b'],
      examples: [
        { a: 'a', b: 'b' },
        { a: 'a', b: 'b' },
        { a: 'a' },
        'INVALID',
      ],
      anyOf: undefined, // allowed any key with undefined value
      enum: undefined, // allowed any key with undefined value
    }

    const [matched, rest] = separateObjectSchema(schema, ['a'])

    expect(matched).toEqual({
      type: 'object',
      description: 'description',
      properties: {
        a: { type: 'string' },
      },
      required: ['a'],
      examples: [
        { a: 'a' },
        { a: 'a' },
        { a: 'a' },
        'INVALID',
      ],
    })
    expect(rest).toEqual({
      type: 'object',
      description: 'description',
      properties: {
        b: { type: 'string' },
      },
      required: ['b'],
      examples: [
        { b: 'b' },
        { b: 'b' },
        {},
        'INVALID',
      ],
    })
  })

  it('can separate if contains additionalProperties', () => {
    const schema: ObjectSchema = {
      type: 'object',
      description: 'description',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a'],
      additionalProperties: true,
    }

    const [matched, rest] = separateObjectSchema(schema, ['a', 'd', 'e'])

    expect(matched).toEqual({
      type: 'object',
      description: 'description',
      properties: {
        a: { type: 'string' },
        d: true,
        e: true,
      },
      required: ['a'],
      additionalProperties: true,
    })
    expect(rest).toEqual({
      type: 'object',
      description: 'description',
      properties: {
        b: { type: 'string' },
      },
      additionalProperties: true,
    })
  })

  it('not separate when contain not allow keyword', () => {
    const schema: ObjectSchema = {
      type: 'object',
      description: 'description',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a', 'b'],
      anyOf: [],
    }

    const [matched, rest] = separateObjectSchema(schema, ['a'])

    expect(matched).toEqual({ type: 'object' })
    expect(rest).toEqual(schema)
  })

  it('with no properties & required', () => {
    const schema: ObjectSchema = {
      type: 'object',
      description: 'description',
    }

    const [matched, rest] = separateObjectSchema(schema, ['a'])

    expect(matched).toEqual(schema)
    expect(rest).toEqual(schema)
  })

  it('with empty properties & required', () => {
    const schema: ObjectSchema = {
      type: 'object',
      description: 'description',
      properties: {},
      required: [],
    }

    const [matched, rest] = separateObjectSchema(schema, ['a'])

    expect(matched).toEqual({
      type: 'object',
      description: 'description',
    })
    expect(rest).toEqual({
      type: 'object',
      description: 'description',
    })
  })
})

describe('filterSchemaBranches', () => {
  it('non-union case', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        c: {
          anyOf: [
            { type: 'string' },
            { type: 'number' },
          ],
        },
      },
      required: ['a'],
    }

    const [matches, rest] = filterSchemaBranches(schema, s => isObject(s) && s.type === 'string')
    expect(matches).toEqual([])
    expect(rest).toEqual(schema)

    const [matches1, rest1] = filterSchemaBranches(schema, s => true)
    expect(matches1).toEqual([schema])
    expect(rest1).toEqual(undefined)
  })

  describe.each(['anyOf', 'oneOf'] as const)('%s', (key) => {
    it('works', () => {
      const schema: JSONSchema = {
        description: 'description',
        [key]: [
          { type: 'string' },
          { type: 'number' },
          { type: 'object' },
        ],
      }

      const [matches, rest] = filterSchemaBranches(schema, s => isObject(s) && s.type === 'string')

      expect(matches).toEqual([{ type: 'string' }])
      expect(rest).toEqual({
        description: 'description',
        [key]: [
          { type: 'number' },
          { type: 'object' },
        ],
      })

      const [matches2, rest2] = filterSchemaBranches(schema, s => false)
      expect(matches2).toEqual([])
      expect(rest2).toEqual(schema)
    })

    it('can simplify rest', () => {
      const schema: JSONSchema = {
        description: 'description',
        $comment: 'comment',
        [key]: [
          { type: 'string' },
          { type: 'number', description: 'number' },
        ],
      }

      const [matches, rest] = filterSchemaBranches(schema, s => isObject(s) && s.type === 'string')

      expect(matches).toEqual([{ type: 'string' }])
      expect(rest).toEqual({ type: 'number', description: 'number', $comment: 'comment' })
    })

    it('not filter when contain not allow keyword', () => {
      const schema: JSONSchema = {
        description: 'description',
        $comment: 'comment',
        const: 'not-allowed',
        [key]: [
          { type: 'string' },
          { type: 'number', description: 'number' },
        ],
      }

      const [matches, rest] = filterSchemaBranches(schema, s => isObject(s) && s.type === 'string')

      expect(matches).toEqual([])
      expect(rest).toEqual(schema)
    })
  })
})

it('applySchemaOptionality', () => {
  expect(applySchemaOptionality(true, { type: 'string' })).toEqual({ type: 'string' })
  expect(applySchemaOptionality(false, { type: 'string' })).toEqual({ anyOf: [{ type: 'string' }, { not: {} }] })
  expect(applySchemaOptionality(false, true)).toEqual({ anyOf: [true, { not: {} }] })
})

it('expandUnionSchema', () => {
  expect(expandUnionSchema(true)).toEqual([true])
  expect(expandUnionSchema({ type: 'string' })).toEqual([{ type: 'string' }])
  expect(expandUnionSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([{ type: 'string' }, { type: 'number' }])
  expect(expandUnionSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([{ type: 'string' }, { type: 'number' }])
  expect(expandUnionSchema({ description: 'description', anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([{ type: 'string' }, { type: 'number' }])
  expect(expandUnionSchema({ anyOf: [{ type: 'string' }, { oneOf: [{ type: 'boolean' }, { type: 'number' }] }] })).toEqual([{ type: 'string' }, { type: 'boolean' }, { type: 'number' }])

  expect(expandUnionSchema({ allOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([{ allOf: [{ type: 'string' }, { type: 'number' }] }])
  expect(expandUnionSchema({ type: 'string', anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([{ type: 'string', anyOf: [{ type: 'string' }, { type: 'number' }] }])
})

it('expandArrayableSchema', () => {
  expect(expandArrayableSchema({ type: 'string' })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string' } }] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }, { type: 'string' }] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string', description: 'something' } }, { type: 'string' }] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'string' }, { type: 'string' }] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'object' }, { type: 'string' }] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [true, true] })).toBe(undefined)
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], oneOf: [] })).toBe(undefined)

  expect(expandArrayableSchema({ oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' } },
  ])
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' } },
  ])
  expect(expandArrayableSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' } },
  ])
  expect(expandArrayableSchema({ anyOf: [{ type: 'array', items: { type: 'string' }, description: 'array of something' }, { type: 'string' }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' }, description: 'array of something' },
  ])
})

it('isPrimitiveSchema', () => {
  expect(isPrimitiveSchema({ type: 'string' })).toBe(true)
  expect(isPrimitiveSchema({ type: 'number' })).toBe(true)
  expect(isPrimitiveSchema({ type: 'integer' })).toBe(true)
  expect(isPrimitiveSchema({ type: 'boolean' })).toBe(true)
  expect(isPrimitiveSchema({ type: 'null' })).toBe(true)
  expect(isPrimitiveSchema({ const: 'const' })).toBe(true)
  expect(isPrimitiveSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe(true)
  expect(isPrimitiveSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe(true)
  expect(isPrimitiveSchema({ description: 'description', anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe(true)
  expect(isPrimitiveSchema({ anyOf: [{ type: 'string' }, { oneOf: [{ type: 'boolean' }, { type: 'number' }] }] })).toBe(true)

  expect(isPrimitiveSchema(true)).toBe(false)
  expect(isPrimitiveSchema(false)).toBe(false)
  expect(isPrimitiveSchema({ allOf: [{ type: 'string' }, { oneOf: [{ type: 'boolean' }, { type: 'number' }] }] })).toBe(false)
  expect(isPrimitiveSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBe(false)
  expect(isPrimitiveSchema({ type: 'array', items: { type: 'string' } })).toBe(false)
  expect(isPrimitiveSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })).toBe(false)
})
