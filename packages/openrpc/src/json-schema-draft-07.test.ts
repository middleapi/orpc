import type { JsonSchema } from '@orpc/json-schema'
import { clone } from '@orpc/shared'
import { toDraft07JsonSchema } from './json-schema-draft-07'

describe('toDraft07JsonSchema', () => {
  it('keeps boolean schemas and schemas without draft 2020-12 keywords', () => {
    expect(toDraft07JsonSchema(true)).toBe(true)
    expect(toDraft07JsonSchema(false)).toBe(false)
    expect(toDraft07JsonSchema({})).toEqual({})

    const schema: JsonSchema = {
      'type': 'object',
      'properties': { a: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' } as JsonSchema },
      'required': ['a'],
      'additionalProperties': false,
      'x-custom': { nested: true },
    }

    expect(toDraft07JsonSchema(schema)).toEqual(schema)
  })

  it('strips $schema at every level', () => {
    expect(toDraft07JsonSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { a: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' } },
    })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
  })

  describe('tuples', () => {
    it('rewrites a closed tuple', () => {
      expect(toDraft07JsonSchema({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        items: false,
        minItems: 2,
        maxItems: 2,
      })).toEqual({
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
        additionalItems: false,
        minItems: 2,
        maxItems: 2,
      })
    })

    it('rewrites a tuple with rest items', () => {
      expect(toDraft07JsonSchema({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
      })).toEqual({
        type: 'array',
        items: [{ type: 'string' }],
        additionalItems: { type: 'number' },
      })
    })

    it('rewrites an open tuple without additionalItems', () => {
      expect(toDraft07JsonSchema({ type: 'array', prefixItems: [{ type: 'string' }] })).toEqual({
        type: 'array',
        items: [{ type: 'string' }],
      })
    })

    it('lowers prefixItems and items schemas', () => {
      expect(toDraft07JsonSchema({
        prefixItems: [{ type: 'array', prefixItems: [{ type: 'string' }], items: false }],
        items: { type: 'array', prefixItems: [{ type: 'number' }] },
      })).toEqual({
        items: [{ type: 'array', items: [{ type: 'string' }], additionalItems: false }],
        additionalItems: { type: 'array', items: [{ type: 'number' }] },
      })
    })

    it('replaces a stray additionalItems with the rest items', () => {
      expect(toDraft07JsonSchema({
        prefixItems: [{ type: 'string' }],
        additionalItems: { type: 'boolean' },
        items: { type: 'number' },
      } as JsonSchema)).toEqual({
        items: [{ type: 'string' }],
        additionalItems: { type: 'number' },
      })
    })

    it('keeps prefixItems next to an items array, which draft-07 already reads as a tuple', () => {
      expect(toDraft07JsonSchema({
        prefixItems: [{ type: 'string' }],
        items: [{ type: 'number' }],
      } as unknown as JsonSchema)).toEqual({
        prefixItems: [{ type: 'string' }],
        items: [{ type: 'number' }],
      })
    })

    it('keeps plain items', () => {
      expect(toDraft07JsonSchema({ type: 'array', items: { type: 'string' } })).toEqual({ type: 'array', items: { type: 'string' } })
    })
  })

  describe('dependencies', () => {
    it('rewrites dependentRequired', () => {
      expect(toDraft07JsonSchema({
        type: 'object',
        dependentRequired: { a: ['b', 'c'] },
      })).toEqual({
        type: 'object',
        dependencies: { a: ['b', 'c'] },
      })
    })

    it('rewrites dependentSchemas', () => {
      expect(toDraft07JsonSchema({
        type: 'object',
        dependentSchemas: { a: { prefixItems: [{ type: 'string' }] } },
      })).toEqual({
        type: 'object',
        dependencies: { a: { items: [{ type: 'string' }] } },
      })
    })

    it('combines a property named in both with allOf', () => {
      expect(toDraft07JsonSchema({
        dependentRequired: { a: ['b'], c: ['d'] },
        dependentSchemas: { a: { required: ['e'] }, f: { required: ['g'] } },
      })).toEqual({
        dependencies: {
          a: { allOf: [{ required: ['b'] }, { required: ['e'] }] },
          c: ['d'],
          f: { required: ['g'] },
        },
      })
    })

    it('merges into existing draft-07 dependencies', () => {
      expect(toDraft07JsonSchema({
        dependencies: { a: { required: ['x'] }, b: ['y'] },
        dependentRequired: { a: ['z'] },
      } as JsonSchema)).toEqual({
        dependencies: {
          a: { allOf: [{ required: ['x'] }, { required: ['z'] }] },
          b: ['y'],
        },
      })
    })

    it('skips undefined entries and does not share property lists with the input', () => {
      const schema = { dependentRequired: { a: ['b'], c: undefined } } as unknown as JsonSchema
      const lowered = toDraft07JsonSchema(schema) as any

      expect(lowered).toEqual({ dependencies: { a: ['b'] } })
      expect(lowered.dependencies.a).not.toBe((schema as any).dependentRequired.a)
    })
  })

  describe('$ref with siblings', () => {
    it('moves the $ref into allOf', () => {
      expect(toDraft07JsonSchema({
        $ref: '#/components/schemas/Planet',
        description: 'A planet',
        default: { name: 'Earth' },
      })).toEqual({
        allOf: [{ $ref: '#/components/schemas/Planet' }],
        description: 'A planet',
        default: { name: 'Earth' },
      })
    })

    it('extends an existing allOf', () => {
      expect(toDraft07JsonSchema({
        $ref: '#/components/schemas/Planet',
        allOf: [{ required: ['name'] }],
      })).toEqual({
        allOf: [{ $ref: '#/components/schemas/Planet' }, { required: ['name'] }],
      })
    })

    it('keeps a lone $ref', () => {
      expect(toDraft07JsonSchema({ $ref: '#/components/schemas/Planet' })).toEqual({ $ref: '#/components/schemas/Planet' })
      expect(toDraft07JsonSchema({ $ref: '#/components/schemas/Planet', description: undefined }))
        .toEqual({ $ref: '#/components/schemas/Planet', description: undefined })
      expect(toDraft07JsonSchema({ $ref: '#/components/schemas/Planet', $schema: 'x' })).toEqual({ $ref: '#/components/schemas/Planet' })
    })

    it('keeps the schema when allOf is malformed', () => {
      const schema = { $ref: '#/components/schemas/Planet', allOf: { type: 'string' } } as unknown as JsonSchema

      expect(toDraft07JsonSchema(schema)).toEqual(schema)
    })

    it('lowers the siblings of a $ref', () => {
      expect(toDraft07JsonSchema({
        $ref: '#/components/schemas/Planet',
        prefixItems: [{ type: 'string' }],
      })).toEqual({
        allOf: [{ $ref: '#/components/schemas/Planet' }],
        items: [{ type: 'string' }],
      })
    })

    it('rewrites nested refs', () => {
      expect(toDraft07JsonSchema({
        type: 'object',
        properties: { planet: { $ref: '#/components/schemas/Planet', description: 'A planet' } },
      })).toEqual({
        type: 'object',
        properties: { planet: { allOf: [{ $ref: '#/components/schemas/Planet' }], description: 'A planet' } },
      })
    })
  })

  it.each([
    ['properties', (s: JsonSchema) => ({ properties: { a: s } })],
    ['patternProperties', (s: JsonSchema) => ({ patternProperties: { '^a': s } })],
    ['additionalProperties', (s: JsonSchema) => ({ additionalProperties: s })],
    ['items', (s: JsonSchema) => ({ items: s })],
    ['items (array)', (s: JsonSchema) => ({ items: [s] })],
    ['additionalItems', (s: JsonSchema) => ({ additionalItems: s })],
    ['contains', (s: JsonSchema) => ({ contains: s })],
    ['propertyNames', (s: JsonSchema) => ({ propertyNames: s })],
    ['allOf', (s: JsonSchema) => ({ allOf: [s] })],
    ['anyOf', (s: JsonSchema) => ({ anyOf: [s] })],
    ['oneOf', (s: JsonSchema) => ({ oneOf: [s] })],
    ['not', (s: JsonSchema) => ({ not: s })],
    ['if', (s: JsonSchema) => ({ if: s })],
    ['then', (s: JsonSchema) => ({ then: s })],
    ['else', (s: JsonSchema) => ({ else: s })],
    ['dependencies', (s: JsonSchema) => ({ dependencies: { a: s } })],
    ['definitions', (s: JsonSchema) => ({ definitions: { A: s } })],
    ['$defs', (s: JsonSchema) => ({ $defs: { A: s } })],
    ['unevaluatedItems', (s: JsonSchema) => ({ unevaluatedItems: s })],
    ['unevaluatedProperties', (s: JsonSchema) => ({ unevaluatedProperties: s })],
  ])('recurses into %s', (_, wrap) => {
    const nested: JsonSchema = { $schema: 'x', type: 'array', prefixItems: [{ type: 'string' }], items: false }
    const lowered = { type: 'array', items: [{ type: 'string' }], additionalItems: false } as unknown as JsonSchema

    expect(toDraft07JsonSchema(wrap(nested) as JsonSchema)).toEqual(wrap(lowered))
  })

  it('keeps boolean subschemas and values of non-schema keywords', () => {
    const schema = {
      type: 'object',
      properties: { a: true, b: false },
      additionalProperties: false,
      const: { prefixItems: [1] },
      enum: [{ $ref: 'not-a-ref', description: 'value' }],
      default: { dependentRequired: { a: ['b'] } },
      examples: [{ $schema: 'value' }],
      contentSchema: { prefixItems: [{ type: 'string' }] },
    } as unknown as JsonSchema

    expect(toDraft07JsonSchema(schema)).toEqual(schema)
  })

  it('keeps __proto__ keys as own properties', () => {
    const properties = JSON.parse('{"__proto__":{"$ref":"#/components/schemas/A","description":"d"}}')
    const lowered = toDraft07JsonSchema({ type: 'object', properties }) as any

    expect(Object.getPrototypeOf(lowered.properties)).toBe(Object.prototype)
    expect(Object.hasOwn(lowered.properties, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(lowered.properties, '__proto__')?.value).toEqual({
      allOf: [{ $ref: '#/components/schemas/A' }],
      description: 'd',
    })
  })

  it('never mutates the input and is idempotent', () => {
    const schema: JsonSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        tuple: { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } },
        planet: { $ref: '#/components/schemas/Planet', description: 'A planet', allOf: [{ required: ['id'] }] },
        nested: { anyOf: [{ $ref: '#/components/schemas/Planet', title: 'Planet' }, { type: 'null' }] },
      },
      dependentRequired: { tuple: ['planet'] },
      dependentSchemas: { tuple: { required: ['nested'] } },
    }
    const original = clone(schema)

    const lowered = toDraft07JsonSchema(schema)

    expect(schema).toEqual(original)
    expect(toDraft07JsonSchema(lowered)).toEqual(lowered)
    expect(lowered).toEqual({
      type: 'object',
      properties: {
        tuple: { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'number' } },
        planet: { allOf: [{ $ref: '#/components/schemas/Planet' }, { required: ['id'] }], description: 'A planet' },
        nested: { anyOf: [{ allOf: [{ $ref: '#/components/schemas/Planet' }], title: 'Planet' }, { type: 'null' }] },
      },
      dependencies: { tuple: { allOf: [{ required: ['planet'] }, { required: ['nested'] }] } },
    })
  })

  it('lowers shared and cyclic subschemas once', () => {
    const shared: any = { type: 'array', prefixItems: [{ type: 'string' }] }
    const cyclic: any = { type: 'object', properties: {} }
    cyclic.properties.self = cyclic

    const lowered = toDraft07JsonSchema({ anyOf: [shared, shared, cyclic] }) as any

    expect(lowered.anyOf[0]).toEqual({ type: 'array', items: [{ type: 'string' }] })
    expect(lowered.anyOf[1]).toBe(lowered.anyOf[0])
    expect(lowered.anyOf[2].properties.self).toBe(lowered.anyOf[2])
    expect(lowered.anyOf[2]).not.toBe(cyclic)
  })
})
