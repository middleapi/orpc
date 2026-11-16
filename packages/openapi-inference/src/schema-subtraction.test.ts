import type { JsonSchema } from '@orpc/json-schema'

import { withoutDescribedSchemas } from './schema-subtraction'

describe('withoutDescribedSchemas', () => {
  it('keeps a schema next to a described schema that is not an object', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(withoutDescribedSchemas(schema, [true])).toBe(schema)
  })

  it('removes properties that add nothing: any value, or a number next to an integer', () => {
    expect(
      withoutDescribedSchemas(
        {
          type: 'object',
          properties: {
            any: true,
            empty: {},
            count: { type: 'number' },
            never: false,
            name: { type: 'string' },
          },
        },
        [
          {
            type: 'object',
            properties: {
              any: { type: 'string' },
              empty: { type: 'string' },
              count: { type: 'integer', minimum: 0 },
              never: { type: 'string' },
            },
          },
        ],
      ),
    ).toEqual({ type: 'object', properties: { never: false, name: { type: 'string' } } })
  })

  it('compares unions by their branches, also of boolean schemas, in any order', () => {
    expect(
      withoutDescribedSchemas(
        {
          type: 'object',
          properties: {
            a: { anyOf: [true, { type: 'string' }] },
            b: { type: 'string' },
          },
        },
        [{ type: 'object', properties: { a: { anyOf: [{ type: 'string' }, true] } } }],
      ),
    ).toEqual({ type: 'object', properties: { b: { type: 'string' } } })
  })

  it('removes the defs nothing refers to anymore', () => {
    expect(
      withoutDescribedSchemas(
        {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'number' } },
          $defs: { Unused: { type: 'string' } },
        },
        [{ type: 'object', properties: { a: { type: 'string' } } }],
      ),
    ).toEqual({ type: 'object', properties: { b: { type: 'number' } } })
  })
})
