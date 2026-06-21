import type { JsonSchema } from './types'
import type { JsonObjectSchema } from './utils'
import {
  combineJsonObjectSchemaEntries,
  combineJsonSchemasWithComposition,
  deduplicateJsonSchemas,
  extractJsonObjectSchemaEntries,
  flattenJsonUnionSchema,
  isJsonPrimitiveSchema,
  matchArrayableJsonSchema,
} from './composition-utils'

it('isJsonPrimitiveSchema', () => {
  expect(isJsonPrimitiveSchema({ type: 'string' })).toBe(true)
  expect(isJsonPrimitiveSchema({ const: 'fixed' })).toBe(true)
  expect(isJsonPrimitiveSchema({ enum: ['a', 'b'] })).toBe(true)
  expect(isJsonPrimitiveSchema({ description: 'primitive union', anyOf: [{ type: 'number' }, { oneOf: [{ type: 'boolean' }, { const: 'x' }] }] })).toBe(true)

  expect(isJsonPrimitiveSchema(true)).toBe(false)
  expect(isJsonPrimitiveSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBe(false)
  expect(isJsonPrimitiveSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })).toBe(false)
})

describe('extractJsonObjectSchemaEntries', () => {
  it('returns undefined for non object-able schemas', () => {
    expect(extractJsonObjectSchemaEntries(true)).toBeUndefined()
    expect(extractJsonObjectSchemaEntries(false)).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ type: 'string' })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ anyOf: [false] })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ anyOf: [{ type: 'string' }] })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ oneOf: [{ type: 'string' }] })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ allOf: [{ type: 'string' }] })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({
      $ref: '#/$defs/Missing',
      $defs: {
        Present: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
    })).toBeUndefined()
    expect(extractJsonObjectSchemaEntries({ })).toBeUndefined()
  })

  it('return empty array for empty object like schemas', () => {
    expect(extractJsonObjectSchemaEntries({ properties: {} })).toEqual([])
    expect(extractJsonObjectSchemaEntries({ anyOf: [{ additionalProperties: {} }] })).toEqual([])
    expect(extractJsonObjectSchemaEntries({ oneOf: [{ properties: {} }] })).toEqual([])
    expect(extractJsonObjectSchemaEntries({ allOf: [{ type: 'object' }] })).toEqual([])
  })

  it('parses direct object properties and preserves root $defs on item schemas', () => {
    const schema: JsonObjectSchema = {
      type: 'object',
      properties: {
        requiredRef: { $ref: '#/$defs/Shared' },
        optionalNever: false,
      },
      required: ['requiredRef'],
      $defs: {
        Shared: { type: 'string' },
      },
    }

    expect(extractJsonObjectSchemaEntries(schema)).toEqual([
      ['requiredRef', { $ref: '#/$defs/Shared', $defs: schema.$defs }, false],
      ['optionalNever', false, true],
    ])
  })

  it('resolves local refs before parsing direct object entries', () => {
    expect(extractJsonObjectSchemaEntries({
      $ref: '#/$defs/Node',
      $defs: {
        Node: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      },
    })).toEqual([
      ['value', {
        type: 'string',
        $defs: {
          Node: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      }, false],
    ])
  })

  it('merges composed object branches into property entries', () => {
    const schema: JsonSchema = {
      anyOf: [
        {
          type: 'object',
          properties: {
            left: { type: 'string' },
            shared: { type: 'string' },
            shared2: { type: 'number' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          properties: {
            right: { type: 'number' },
            shared: { maxLength: 10, type: 'string' },
            shared2: { type: 'boolean' },
          },
        },
      ],
      allOf: [
        {
          type: 'object',
          properties: {
            shared: { minLength: 1, type: 'string' },
            fixed: { const: 'x' },
          },
          required: ['shared'],
        },
      ],
      $defs: {
        Shared: { type: 'boolean' },
      },
    }

    expect(extractJsonObjectSchemaEntries(schema)).toEqual([
      ['left', { type: 'string', $defs: schema.$defs }, true],
      ['shared', {
        allOf: [
          { minLength: 1, type: 'string' },
          {
            anyOf: [
              { type: 'string' },
              { maxLength: 10, type: 'string' },
            ],
          },
        ],
        $defs: schema.$defs,
      }, false],
      ['shared2', {
        $defs: {
          Shared: {
            type: 'boolean',
          },
        },
        anyOf: [{ type: 'number' }, { type: 'boolean' }],
      }, true],
      ['right', { type: 'number', $defs: schema.$defs }, true],
      ['fixed', { const: 'x', $defs: schema.$defs }, true],
    ])
  })

  it('includes same-level object properties when composition keywords are also present', () => {
    expect(extractJsonObjectSchemaEntries({
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            branch: { type: 'string' },
          },
        },
      ],
    })).toEqual([
      ['branch', { type: 'string' }, true],
    ])
  })

  it('wraps pure union property merges in anyOf', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
        },
      ],
    })).toEqual([
      ['value', { anyOf: [{ type: 'string' }, { type: 'number' }] }, true],
    ])
  })

  it('wraps pure intersection property merges in allOf', () => {
    expect(extractJsonObjectSchemaEntries({
      allOf: [
        {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            value: { minLength: 1 },
          },
        },
      ],
    })).toEqual([
      ['value', { allOf: [{ type: 'string' }, { minLength: 1 }] }, true],
    ])
  })

  it('deduplicates identical union and intersection property schemas', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        {
          type: 'object',
          properties: {
            a: { type: 'string' },
          },
          required: ['a'],
        },
      ],
      allOf: [
        {
          type: 'object',
          properties: {
            a: { type: 'string' },
          },
        },
      ],
    })).toEqual([
      ['a', { type: 'string' }, false],
    ])
  })

  it('marks union properties optional unless every branch requires them', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
          required: ['p1', 'p2'],
        },
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
          required: ['p1', 'p3'],
        },
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
          required: ['p1', 'p2', 'p3'],
        },
      ],
    })).toEqual([
      ['p1', { type: 'boolean' }, false],
      ['p2', { type: 'boolean' }, true],
      ['p3', { type: 'boolean' }, true],
    ])
  })

  it('marks intersection properties required when any branch requires them', () => {
    expect(extractJsonObjectSchemaEntries({
      allOf: [
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
          required: ['p2'],
        },
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
          required: ['p3'],
        },
        {
          type: 'object',
          properties: {
            p1: { type: 'boolean' },
            p2: { type: 'boolean' },
            p3: { type: 'boolean' },
          },
        },
      ],
    })).toEqual([
      ['p1', { type: 'boolean' }, true],
      ['p2', { type: 'boolean' }, false],
      ['p3', { type: 'boolean' }, false],
    ])
  })

  it('uses hoisted defs for recursive root refs', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        self: { $ref: '#' },
        leaf: { $ref: '#/$defs/Leaf' },
      },
      required: ['self'],
      $defs: {
        Leaf: { type: 'string' },
      },
    }

    expect(extractJsonObjectSchemaEntries(schema)).toEqual([
      ['self', {
        $ref: '#/$defs/__schema0',
        $defs: {
          Leaf: { type: 'string' },
          __schema0: {
            type: 'object',
            properties: {
              self: { $ref: '#/$defs/__schema0' },
              leaf: { $ref: '#/$defs/Leaf' },
            },
            required: ['self'],
          },
        },
      }, false],
      ['leaf', {
        $ref: '#/$defs/Leaf',
        $defs: {
          Leaf: { type: 'string' },
          __schema0: {
            type: 'object',
            properties: {
              self: { $ref: '#/$defs/__schema0' },
              leaf: { $ref: '#/$defs/Leaf' },
            },
            required: ['self'],
          },
        },
      }, true],
    ])
  })

  it('extracts properties from recursive $ref nested unions and intersections', () => {
    const schema: JsonSchema = {
      $ref: '#/$defs/Node',
      $defs: {
        Node: {
          anyOf: [
            {
              type: 'object',
              properties: {
                p1: { type: 'string' },
              },
            },
            { anyOf: [{ $ref: '#/$defs/Shared' }] },
            { anyOf: [{ $ref: '#/$defs/Node' }] },
          ],
          allOf: [
            {
              type: 'object',
              properties: {
                p1: { type: 'string' },
                p2: { type: 'string' },
              },
              required: ['p1'],
            },
            { allOf: [{ $ref: '#/$defs/Node' }] },
          ],
        },
        Shared: {
          type: 'object',
          properties: {
            p3: { type: 'boolean' },
          },
        },
      },
    }

    expect(extractJsonObjectSchemaEntries(schema)).toEqual([
      ['p1', { $defs: schema.$defs, type: 'string' }, false],
      ['p3', { $defs: schema.$defs, type: 'boolean' }, true],
      ['p2', { $defs: schema.$defs, type: 'string' }, true],
    ])
  })

  it('keeps properties required when a single anyOf branch contains an allOf composition', () => {
    const schema: JsonSchema = {
      anyOf: [
        {
          allOf: [
            { properties: { p1: { type: 'boolean' } }, required: ['p1'] },
            { properties: { p2: { type: 'string' } }, required: ['p2'] },
          ],
        },
      ],
    }

    expect(extractJsonObjectSchemaEntries(schema)).toEqual([
      ['p1', { $defs: schema.$defs, type: 'boolean' }, false],
      ['p2', { $defs: schema.$defs, type: 'string' }, false],
    ])
  })

  it('marks nested anyOf properties optional unless every allOf branch requires them', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        {
          allOf: [
            { properties: { shared: { type: 'boolean' } }, required: ['shared'] },
            { properties: { left: { type: 'string' } }, required: ['left'] },
          ],
        },
        {
          allOf: [
            { properties: { shared: { type: 'boolean' } }, required: ['shared'] },
            { properties: { right: { type: 'number' } }, required: ['right'] },
          ],
        },
      ],
    })).toEqual([
      ['shared', { type: 'boolean' }, false],
      ['left', { type: 'string' }, true],
      ['right', { type: 'number' }, true],
    ])
  })

  it('marks nested oneOf properties optional unless every allOf branch requires them', () => {
    expect(extractJsonObjectSchemaEntries({
      oneOf: [
        {
          allOf: [
            { properties: { shared: { type: 'boolean' } }, required: ['shared'] },
            { properties: { left: { type: 'string' } }, required: ['left'] },
          ],
        },
        {
          allOf: [
            { properties: { shared: { type: 'boolean' } }, required: ['shared'] },
            { properties: { right: { type: 'number' } }, required: ['right'] },
          ],
        },
      ],
    })).toEqual([
      ['shared', { type: 'boolean' }, false],
      ['left', { type: 'string' }, true],
      ['right', { type: 'number' }, true],
    ])
  })

  it('preserves required properties from nested anyOf branches when merged through outer allOf', () => {
    expect(extractJsonObjectSchemaEntries({
      allOf: [
        {
          anyOf: [
            {
              type: 'object',
              properties: {
                shared: { type: 'string' },
                left: { type: 'boolean' },
              },
              required: ['shared', 'left'],
            },
            {
              type: 'object',
              properties: {
                shared: { type: 'string' },
                right: { type: 'number' },
              },
              required: ['shared'],
            },
          ],
        },
        {
          properties: {
            extra: { type: 'null' },
          },
          required: ['extra'],
        },
      ],
    })).toEqual([
      ['shared', { type: 'string' }, false],
      ['left', { type: 'boolean' }, true],
      ['right', { type: 'number' }, true],
      ['extra', { type: 'null' }, false],
    ])
  })

  it('includes top-level required for object schemas with properties and composition', () => {
    expect(extractJsonObjectSchemaEntries({
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
      required: ['a'],
      allOf: [
        {
          type: 'object',
          properties: {
            b: { type: 'number' },
          },
        },
      ],
    })).toEqual([
      ['a', { type: 'string' }, false],
      ['b', { type: 'number' }, true],
    ])
  })

  it('handles top-level object with properties but no required', () => {
    expect(extractJsonObjectSchemaEntries({
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
      allOf: [
        {
          type: 'object',
          properties: {
            b: { type: 'number' },
          },
        },
      ],
    })).toEqual([
      ['a', { type: 'string' }, true],
      ['b', { type: 'number' }, true],
    ])
  })

  it('handles composition branches that are object schemas without properties', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        { type: 'object' },
        {
          type: 'object',
          properties: {
            a: { type: 'string' },
          },
        },
      ],
    })).toEqual([
      ['a', { type: 'string' }, true],
    ])
  })

  it('sorts anyOf and oneOf groups after allOf groups', () => {
    expect(extractJsonObjectSchemaEntries({
      anyOf: [
        {
          type: 'object',
          properties: {
            shared: { type: 'string' },
          },
        },
      ],
      oneOf: [
        {
          type: 'object',
          properties: {
            shared: { type: 'number' },
          },
        },
      ],
    })).toEqual([
      ['shared', { allOf: [{ type: 'string' }, { type: 'number' }] }, true],
    ])
  })
})

describe('combineJsonObjectSchemaEntries', () => {
  it('combines entries into a single object schema', () => {
    expect(combineJsonObjectSchemaEntries([
      ['requiredRef', {
        $ref: '#/$defs/Shared',
        $defs: {
          Shared: { type: 'string' },
        },
      }, false],
      ['optionalNever', false, true],
    ])).toEqual({
      type: 'object',
      properties: {
        requiredRef: {
          $ref: '#/$defs/Shared',
        },
        optionalNever: false,
      },
      required: ['requiredRef'],
      $defs: {
        Shared: { type: 'string' },
      },
    })
  })

  it('rewrites absolute refs to the property path when embedding property schemas', () => {
    expect(combineJsonObjectSchemaEntries([
      ['node', {
        type: 'object',
        properties: {
          self: { $ref: '#' },
          brother: { $ref: '#/properties/self' },
          unchanged: { $ref: '0/unchanged' },
        },
        required: ['self'],
      }, false],
    ])).toEqual({
      type: 'object',
      properties: {
        node: {
          type: 'object',
          properties: {
            self: { $ref: '#/properties/node' },
            brother: { $ref: '#/properties/node/properties/self' },
            unchanged: { $ref: '0/unchanged' },
          },
          required: ['self'],
        },
      },
      required: ['node'],
    })
  })

  it('dedupe and renames conflicting defs while hoisting property schemas', () => {
    expect(combineJsonObjectSchemaEntries([
      ['left', {
        $ref: '#/$defs/Shared',
        $defs: {
          Node: { type: 'string' },
          Shared: { type: 'string' },
        },
      }, false],
      ['right', {
        allOf: [{ $ref: '#/$defs/Shared' }],
        $defs: {
          Node: { type: 'string' },
          Shared: { type: 'number' },
        },
      }, true],
    ])).toEqual({
      type: 'object',
      properties: {
        left: {
          $ref: '#/$defs/Shared',
        },
        right: {
          allOf: [{ $ref: '#/$defs/Shared2' }],
        },
      },
      required: ['left'],
      $defs: {
        Node: { type: 'string' },
        Shared: { type: 'string' },
        Shared2: { type: 'number' },
      },
    })
  })

  it('round-trips entries extracted from an object schema', () => {
    const schema: JsonObjectSchema = {
      type: 'object',
      properties: {
        requiredRef: { $ref: '#/$defs/Shared' },
        optionalNever: false,
      },
      required: ['requiredRef'],
      $defs: {
        Shared: { type: 'string' },
      },
    }

    expect(combineJsonObjectSchemaEntries(extractJsonObjectSchemaEntries(schema)!)).toEqual(schema)
  })

  it('keeps unknown refs untouched while deduplicating and renaming promoted defs', () => {
    expect(combineJsonObjectSchemaEntries([
      ['first', {
        anyOf: [
          { $ref: '#/$defs/Shared' },
          { $ref: '#/$defs/External' },
          { $ref: '../External' },
          { $ref: '#/$defs/Shared/properties/value' },
          { $ref: '#/nonExists' },
        ],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
          },
          Shared2: {
            type: 'boolean',
          },
          Equal: {
            type: 'null',
          },
          Missing: undefined as any,
        },
      }, true],
      ['second', {
        allOf: [
          { $ref: '#/$defs/Shared' },
          { $ref: '#/$defs/Shared/properties/value' },
        ],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
          },
          Equal: {
            type: 'null',
          },
        },
      }, true],
    ])).toEqual({
      type: 'object',
      properties: {
        first: {
          anyOf: [
            { $ref: '#/$defs/Shared' },
            { $ref: '#/$defs/External' },
            { $ref: '../External' },
            { $ref: '#/$defs/Shared/properties/value' },
            { $ref: '#/nonExists' },
          ],
        },
        second: {
          allOf: [
            { $ref: '#/$defs/Shared3' },
            { $ref: '#/$defs/Shared3/properties/value' },
          ],
        },
      },
      $defs: {
        Shared: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        Shared2: {
          type: 'boolean',
        },
        Equal: {
          type: 'null',
        },
        Shared3: {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
        },
      },
    })
  })
})

describe('flattenJsonUnionSchema', () => {
  it('returns non-union schemas as a single branch', () => {
    expect(flattenJsonUnionSchema(true)).toEqual([true])
    expect(flattenJsonUnionSchema({ type: 'string' })).toEqual([{ type: 'string' }])
  })

  it('flattens direct anyOf and oneOf branches', () => {
    expect(flattenJsonUnionSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([
      { type: 'string' },
      { type: 'number' },
    ])

    expect(flattenJsonUnionSchema({ description: 'metadata', oneOf: [{ type: 'boolean' }, { type: 'null' }] })).toEqual([
      { description: 'metadata', type: 'boolean' },
      { description: 'metadata', type: 'null' },
    ])
  })

  it('keeps unions with additional constraints in child', () => {
    const constrainedUnion: JsonSchema = {
      pattern: '.*',
      anyOf: [{ type: 'string' }, { type: 'number' }],
    }

    expect(flattenJsonUnionSchema(constrainedUnion)).toEqual([
      { pattern: '.*', type: 'string' },
      { pattern: '.*', type: 'number' },
    ])
  })

  it('moves conflicting sibling constraints into allOf', () => {
    const schema: JsonSchema = {
      description: 'root metadata',
      anyOf: [{ description: 'branch metadata', type: 'string', allOf: [{ maxLength: 4 }] }],
    }

    expect(flattenJsonUnionSchema(schema)).toEqual([
      {
        description: 'branch metadata',
        type: 'string',
        allOf: [{ maxLength: 4 }, { description: 'root metadata' }],
      },
    ])
  })

  it('keeps unresolved $ref branches intact while flattening sibling unions', () => {
    const schema = {
      $defs: { Shared: { type: 'string' } },
      anyOf: [{ $ref: '#/$defs/Shared' }, { oneOf: [{ type: 'number' }, { type: 'boolean' }] }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, $ref: '#/$defs/Shared' },
      { $defs: schema.$defs, type: 'number' },
      { $defs: schema.$defs, type: 'boolean' },
    ])
  })

  it('flattening union $ref branches', () => {
    const schema = {
      description: 'metadata',
      $defs: { Shared: { anyOf: [{ type: 'number' }, { type: 'boolean' }] } },
      anyOf: [{ $ref: '#/$defs/Shared' }, { type: 'string' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, description: 'metadata', type: 'number' },
      { $defs: schema.$defs, description: 'metadata', type: 'boolean' },
      { $defs: schema.$defs, description: 'metadata', type: 'string' },
    ])
  })

  it('flattens transitive local $ref union branches', () => {
    const schema = {
      $defs: {
        Shared: { $ref: '#/$defs/Alias' },
        Alias: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
      },
      anyOf: [{ $ref: '#/$defs/Shared' }, { type: 'string' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, type: 'number' },
      { $defs: schema.$defs, type: 'boolean' },
      { $defs: schema.$defs, type: 'string' },
    ])
  })

  it('keeps missing local $defs refs intact', () => {
    const schema = {
      $defs: {
        Present: { type: 'string' },
      },
      anyOf: [{ $ref: '#/$defs/Missing' }, { type: 'number' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, $ref: '#/$defs/Missing' },
      { $defs: schema.$defs, type: 'number' },
    ])
  })

  it('flattening recursive union $ref branches', () => {
    const schema = {
      $defs: { Shared: { anyOf: [{ type: 'number' }, { type: 'boolean' }, { $ref: '#/$defs/Shared' }] } },
      anyOf: [{ $ref: '#/$defs/Shared' }, { type: 'string' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, type: 'number' },
      { $defs: schema.$defs, type: 'boolean' },
      { $defs: schema.$defs, type: 'string' },
    ])
  })

  it('dedupe json schemas result', () => {
    const schema = {
      $defs: { Shared: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
      anyOf: [{ $ref: '#/$defs/Shared' }, { type: 'string' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, type: 'string' },
      { $defs: schema.$defs, type: 'boolean' },
    ])
  })

  it('can flat mixed oneOf and anyOf', () => {
    const schema = {
      $defs: { Shared: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
      anyOf: [{ $ref: '#/$defs/Shared' }],
      oneOf: [{ type: 'string' }],
    } satisfies JsonSchema

    expect(flattenJsonUnionSchema(schema)).toEqual([
      { $defs: schema.$defs, type: 'string' },
      { $defs: schema.$defs, type: 'boolean' },
    ])
  })
})

it('matchArrayableJsonSchema', () => {
  expect(matchArrayableJsonSchema({ type: 'string' })).toBeUndefined()
  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBeUndefined()
  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'number' }] })).toBeUndefined()
  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'array' }, { type: 'number' }] })).toBeUndefined()

  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, description: 'many strings' }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' }, description: 'many strings' },
  ])
  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'array', items: { type: 'string' }, minItems: 1 }, { type: 'string' }] })).toEqual([
    { type: 'string' },
    { type: 'array', items: { type: 'string' }, minItems: 1 },
  ])

  expect(matchArrayableJsonSchema({
    anyOf: [
      { type: 'string', description: 'ignore1' },
      { type: 'array', items: { type: 'string', description: 'ignore2' }, description: 'many strings' },
    ],
  })).toEqual([
    { type: 'string', description: 'ignore1' },
    { type: 'array', items: { type: 'string', description: 'ignore2' }, description: 'many strings' },
  ])

  expect(matchArrayableJsonSchema({ anyOf: [{ type: 'array' }, { }] })).toEqual([{}, { type: 'array' }])
})

describe('combineJsonSchemasWithComposition', () => {
  it('when schemas.length <= 1', () => {
    expect(combineJsonSchemasWithComposition('anyOf', [])).toEqual(true)
    expect(combineJsonSchemasWithComposition('anyOf', [{ type: 'string' }])).toEqual({ type: 'string' })
  })

  it('returns a plain allOf wrapper when no branch defines $defs', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      { type: 'string' },
      false,
    ])).toEqual({
      allOf: [
        { type: 'string' },
        false,
      ],
    })
  })

  it('promotes branch defs to the root', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          left: { $ref: '#/$defs/Shared' },
        },
        required: ['left'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              left: { type: 'string' },
            },
            required: ['left'],
          },
        },
      },
      {
        type: 'object',
        properties: {
          right: { $ref: '#/$defs/SharedRight' },
        },
        required: ['right'],
        $defs: {
          SharedRight: {
            type: 'object',
            properties: {
              right: { type: 'number' },
            },
            required: ['right'],
          },
        },
      },
      {
        type: 'object',
        properties: {
          third: { $ref: '#/$defs/SharedThird' },
        },
        required: ['third'],
        $defs: {
          SharedThird: {
            type: 'object',
            properties: {
              third: { type: 'boolean' },
            },
            required: ['third'],
          },
        },
      },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            left: { $ref: '#/$defs/Shared' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          properties: {
            right: { $ref: '#/$defs/SharedRight' },
          },
          required: ['right'],
        },
        {
          type: 'object',
          properties: {
            third: { $ref: '#/$defs/SharedThird' },
          },
          required: ['third'],
        },
      ],
      $defs: {
        Shared: {
          type: 'object',
          properties: {
            left: { type: 'string' },
          },
          required: ['left'],
        },
        SharedRight: {
          type: 'object',
          properties: {
            right: { type: 'number' },
          },
          required: ['right'],
        },
        SharedThird: {
          type: 'object',
          properties: {
            third: { type: 'boolean' },
          },
          required: ['third'],
        },
      },
    })
  })

  it('renames conflicting defs across branches and rewrites refs across supported schema keywords in the current scope', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          left: { $ref: '#/$defs/Shared' },
        },
        required: ['left'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              left: { type: 'string' },
            },
            required: ['left'],
          },
        },
      },
      {
        type: 'object',
        allOf: [{ $ref: '#/$defs/Shared' }],
        anyOf: [{ $ref: '#/$defs/Shared' }],
        oneOf: [{ $ref: '#/$defs/Shared' }],
        items: { $ref: '#/$defs/Shared' },
        additionalProperties: { $ref: '#/$defs/Shared' },
        not: { $ref: '#/$defs/Shared' },
        if: { $ref: '#/$defs/Shared' },
        then: { $ref: '#/$defs/Shared' },
        else: { $ref: '#/$defs/Shared' },
        prefixItems: [{ $ref: '#/$defs/Shared' }],
        properties: {
          right: { $ref: '#/$defs/Shared' },
          rightDeep: { $ref: '#/$defs/Shared/properties/right' },
        },
        required: ['right'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              right: { type: 'number' },
            },
            required: ['right'],
          },
        },
        examples: [
          { $ref: '#/$defs/Shared' },
        ],
      },
      {
        type: 'object',
        properties: {
          duplicate: { $ref: '#/$defs/Shared' },
        },
        required: ['duplicate'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              left: { type: 'string' },
            },
            required: ['left'],
          },
        },
      },
      {
        type: 'object',
        properties: {
          third: { $ref: '#/$defs/Shared' },
        },
        required: ['third'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              third: { type: 'boolean' },
            },
            required: ['third'],
          },
        },
      },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            left: { $ref: '#/$defs/Shared' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          allOf: [{ $ref: '#/$defs/Shared2' }],
          anyOf: [{ $ref: '#/$defs/Shared2' }],
          oneOf: [{ $ref: '#/$defs/Shared2' }],
          items: { $ref: '#/$defs/Shared2' },
          additionalProperties: { $ref: '#/$defs/Shared2' },
          not: { $ref: '#/$defs/Shared2' },
          if: { $ref: '#/$defs/Shared2' },
          then: { $ref: '#/$defs/Shared2' },
          else: { $ref: '#/$defs/Shared2' },
          prefixItems: [{ $ref: '#/$defs/Shared2' }],
          properties: {
            right: { $ref: '#/$defs/Shared2' },
            rightDeep: { $ref: '#/$defs/Shared2/properties/right' },
          },
          required: ['right'],
          examples: [
            { $ref: '#/$defs/Shared' },
          ],
        },
        {
          type: 'object',
          properties: {
            duplicate: { $ref: '#/$defs/Shared' },
          },
          required: ['duplicate'],
        },
        {
          type: 'object',
          properties: {
            third: { $ref: '#/$defs/Shared3' },
          },
          required: ['third'],
        },
      ],
      $defs: {
        Shared: {
          type: 'object',
          properties: {
            left: { type: 'string' },
          },
          required: ['left'],
        },
        Shared2: {
          type: 'object',
          properties: {
            right: { type: 'number' },
          },
          required: ['right'],
        },
        Shared3: {
          type: 'object',
          properties: {
            third: { type: 'boolean' },
          },
          required: ['third'],
        },
      },
    })
  })

  it('reuses the same def name when conflicting defs are equal', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          left: { $ref: '#/$defs/Shared' },
        },
        required: ['left'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      },
      {
        type: 'object',
        properties: {
          right: { $ref: '#/$defs/Shared' },
        },
        required: ['right'],
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            left: { $ref: '#/$defs/Shared' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          properties: {
            right: { $ref: '#/$defs/Shared' },
          },
          required: ['right'],
        },
      ],
      $defs: {
        Shared: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      },
    })
  })

  it('ignore relative refs unchanged', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          direct: { $ref: '#/$defs/Shared' },
          unchanged: { $ref: '1/Unknown' },
          unchanged2: { $ref: '../Unknown' },
          childSchema: {
            type: 'object',
            properties: {
              inner: { $ref: '#/properties/childSchema/$defs/Shared' },
            },
            required: ['inner'],
            $defs: {
              Shared: { type: 'integer' },
            },
          },
        },
        $defs: {
          Shared: {
            type: 'object',
            properties: {
              left: { type: 'string' },
            },
            required: ['left'],
          },
        },
      },
      { type: 'object' },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            direct: { $ref: '#/$defs/Shared' },
            unchanged: { $ref: '1/Unknown' },
            unchanged2: { $ref: '../Unknown' },
            childSchema: {
              type: 'object',
              properties: {
                inner: { $ref: '#/allOf/0/properties/childSchema/$defs/Shared' },
              },
              required: ['inner'],
              $defs: {
                Shared: { type: 'integer' },
              },
            },
          },
        },
        { type: 'object' },
      ],
      $defs: {
        Shared: {
          type: 'object',
          properties: {
            left: { type: 'string' },
          },
          required: ['left'],
        },
      },
    })
  })

  it('preserves encoded pointer refs', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          encoded: { $ref: '#/$defs/path~1name' },
          toggle: { $ref: '#/$defs/Flag' },
        },
        required: ['encoded', 'toggle'],
        $defs: {
          'path/name': {
            type: 'string',
          },
          'Flag': true,
        },
      },
      { type: 'object' },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            encoded: { $ref: '#/$defs/path~1name' },
            toggle: { $ref: '#/$defs/Flag' },
          },
          required: ['encoded', 'toggle'],
        },
        { type: 'object' },
      ],
      $defs: {
        'path/name': {
          type: 'string',
        },
        'Flag': true,
      },
    })
  })

  it('ignores undefined defs entries while promoting valid defs', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          value: { $ref: '#/$defs/Real' },
        },
        $defs: {
          Real: { type: 'string' },
          Missing: undefined as any,
        },
      },
      { type: 'object' },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            value: { $ref: '#/$defs/Real' },
          },
        },
        { type: 'object' },
      ],
      $defs: {
        Real: { type: 'string' },
      },
    })
  })

  it('rewrites absolute refs to the exact allOf branch path', () => {
    expect(combineJsonSchemasWithComposition('allOf', [
      {
        type: 'object',
        properties: {
          child: { $ref: '#' },
          brother: { $ref: '#/properties/child' },
          nonExists: { $ref: '#/nonExists' },
        },
        required: ['child'],
      },
      { type: 'object' },
    ])).toEqual({
      allOf: [
        {
          type: 'object',
          properties: {
            child: { $ref: '#/allOf/0' },
            brother: { $ref: '#/allOf/0/properties/child' },
            nonExists: { $ref: '#/nonExists' },
          },
          required: ['child'],
        },
        { type: 'object' },
      ],
    })
  })

  it('supports anyOf', () => {
    expect(combineJsonSchemasWithComposition('anyOf', [
      {
        type: 'object',
        properties: {
          left: { $ref: '#/$defs/Shared' },
        },
        required: ['left'],
        $defs: {
          Shared: {
            type: 'string',
          },
        },
      },
      {
        type: 'object',
        properties: {
          right: { $ref: '#' },
          nested: { $ref: '#/properties/right' },
        },
        required: ['right', 'nested'],
      },
    ])).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {
            left: { $ref: '#/$defs/Shared' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          properties: {
            right: { $ref: '#/anyOf/1' },
            nested: { $ref: '#/anyOf/1/properties/right' },
          },
          required: ['right', 'nested'],
        },
      ],
      $defs: {
        Shared: {
          type: 'string',
        },
      },
    })
  })

  it('supports oneOf', () => {
    expect(combineJsonSchemasWithComposition('oneOf', [
      {
        type: 'object',
        properties: {
          left: { $ref: '#/$defs/Shared' },
        },
        required: ['left'],
        $defs: {
          Shared: {
            type: 'string',
          },
        },
      },
      {
        type: 'object',
        properties: {
          right: { $ref: '#/$defs/Shared' },
          childSchema: {
            type: 'object',
            properties: {
              nested: { $ref: '#/properties/right' },
            },
            required: ['nested'],
          },
        },
        required: ['right', 'childSchema'],
        $defs: {
          Shared: {
            type: 'number',
          },
        },
      },
    ])).toEqual({
      oneOf: [
        {
          type: 'object',
          properties: {
            left: { $ref: '#/$defs/Shared' },
          },
          required: ['left'],
        },
        {
          type: 'object',
          properties: {
            right: { $ref: '#/$defs/Shared2' },
            childSchema: {
              type: 'object',
              properties: {
                nested: { $ref: '#/oneOf/1/properties/right' },
              },
              required: ['nested'],
            },
          },
          required: ['right', 'childSchema'],
        },
      ],
      $defs: {
        Shared: {
          type: 'string',
        },
        Shared2: {
          type: 'number',
        },
      },
    })
  })
})

describe('deduplicateJsonSchemas', () => {
  it('removes structurally identical schemas while preserving the first occurrence order', () => {
    const shared = { type: 'string', minLength: 1 } satisfies JsonSchema

    expect(deduplicateJsonSchemas([
      shared,
      { type: 'number' },
      { type: 'string', minLength: 1 },
      { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
      { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    ])).toEqual([
      shared,
      { type: 'number' },
      { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    ])
  })

  it('keeps distinct boolean and object schemas', () => {
    expect(deduplicateJsonSchemas([
      true,
      false,
      true,
      { const: 'x' },
      { const: 'x' },
      false,
    ])).toEqual([
      true,
      false,
      { const: 'x' },
    ])
  })

  it('treats schemas with different defs as distinct', () => {
    expect(deduplicateJsonSchemas([
      {
        $ref: '#/$defs/Shared',
        $defs: {
          Shared: { type: 'string' },
        },
      },
      {
        $ref: '#/$defs/Shared',
        $defs: {
          Shared: { type: 'number' },
        },
      },
    ])).toEqual([
      {
        $ref: '#/$defs/Shared',
        $defs: {
          Shared: { type: 'string' },
        },
      },
      {
        $ref: '#/$defs/Shared',
        $defs: {
          Shared: { type: 'number' },
        },
      },
    ])
  })
})
