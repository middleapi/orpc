import {
  createUndefinedJsonSchema,
  JSON_SCHEMA_UNDEFINED_MARKER,
  normalizeJsonSchema,
  replaceNonFiniteJsonSchemaValues,
} from './normalize-utils.ts'
import type { JsonSchema } from './types.ts'

const UNDEFINED = createUndefinedJsonSchema()

describe('createUndefinedJsonSchema', () => {
  it('creates a marked schema matching nothing', () => {
    expect(createUndefinedJsonSchema()).toEqual({ not: {}, [JSON_SCHEMA_UNDEFINED_MARKER]: true })
    expect(createUndefinedJsonSchema()).not.toBe(createUndefinedJsonSchema())
  })

  it('survives JSON cloning', () => {
    expect(JSON.parse(JSON.stringify(createUndefinedJsonSchema()))).toEqual(UNDEFINED)
  })
})

describe('replaceNonFiniteJsonSchemaValues', () => {
  it.each<[string, JsonSchema, JsonSchema]>([
    ['const Infinity', { const: Infinity }, { not: {} }],
    ['const -Infinity', { const: -Infinity, description: 'd' }, { not: {}, description: 'd' }],
    ['const NaN', { type: 'number', const: Number.NaN }, { type: 'number', not: {} }],
    [
      'enum with non-finite members',
      { type: 'number', enum: [1, Infinity, Number.NaN] },
      { type: 'number', enum: [1] },
    ],
    ['enum of only non-finite members', { enum: [Infinity, -Infinity] }, { not: {} }],
  ])('replaces %s', (_, schema, expected) => {
    expect(replaceNonFiniteJsonSchemaValues(schema)).toEqual(expected)
  })

  it.each<[string, JsonSchema]>([
    ['boolean', true],
    ['finite const', { const: 1 }],
    ['finite enum', { enum: [1, 'a', null] }],
    ['no const/enum', { type: 'number' }],
  ])('returns %s schemas as-is', (_, schema) => {
    expect(replaceNonFiniteJsonSchemaValues(schema)).toBe(schema)
  })

  it('does not walk sub-schemas', () => {
    const schema: JsonSchema = { anyOf: [{ const: Infinity }] }
    expect(replaceNonFiniteJsonSchemaValues(schema)).toBe(schema)
  })

  it('uses a custom resolver', () => {
    const resolveNonFiniteValue = vi.fn((value: number) => ({ description: String(value) }))

    expect(
      replaceNonFiniteJsonSchemaValues({ const: Infinity }, { resolveNonFiniteValue }),
    ).toEqual({ description: 'Infinity' })
    expect(
      replaceNonFiniteJsonSchemaValues({ enum: [1, -Infinity] }, { resolveNonFiniteValue }),
    ).toEqual({ anyOf: [{ enum: [1] }, { description: '-Infinity' }] })
    expect(
      replaceNonFiniteJsonSchemaValues(
        { enum: [1, Number.NaN], anyOf: [{ type: 'number' }] },
        { resolveNonFiniteValue },
      ),
    ).toEqual({
      anyOf: [{ type: 'number' }],
      allOf: [{ anyOf: [{ enum: [1] }, { description: 'NaN' }] }],
    })
    expect(
      replaceNonFiniteJsonSchemaValues({ const: Infinity }, { resolveNonFiniteValue: () => false }),
    ).toEqual({ not: {} })
    expect(resolveNonFiniteValue.mock.calls).toEqual([[Infinity], [-Infinity], [Number.NaN]])
  })
})

describe('normalizeJsonSchema', () => {
  describe('undefined', () => {
    it.each<[string, JsonSchema, JsonSchema]>([
      ['the undefined schema', UNDEFINED, { not: {} }],
      ['an anyOf branch', { anyOf: [{ type: 'string' }, UNDEFINED] }, { type: 'string' }],
      ['a oneOf branch', { oneOf: [{ type: 'string' }, UNDEFINED] }, { type: 'string' }],
      [
        'an anyOf branch next to other branches',
        { anyOf: [{ type: 'string' }, { type: 'null' }, UNDEFINED] },
        { anyOf: [{ type: 'string' }, { type: 'null' }] },
      ],
      [
        'an anyOf branch next to other keywords',
        { description: 'd', anyOf: [{ type: 'string' }, UNDEFINED] },
        { description: 'd', anyOf: [{ type: 'string' }] },
      ],
      ['every anyOf branch', { anyOf: [UNDEFINED, UNDEFINED] }, { not: {} }],
      [
        'a branch that extends the marked schema',
        { anyOf: [{ type: 'string' }, { ...UNDEFINED, title: 'T' }] },
        { type: 'string' },
      ],
      [
        'array items',
        { type: 'array', items: { anyOf: [{ type: 'string' }, UNDEFINED] } },
        { type: 'array', items: { type: 'string' } },
      ],
    ])('drops %s', (_, schema, expected) => {
      expect(normalizeJsonSchema(schema)).toEqual(expected)
    })

    it('drops an anyOf branch referencing the undefined schema', () => {
      expect(
        normalizeJsonSchema({
          anyOf: [{ type: 'string' }, { $ref: '#/$defs/U' }],
          $defs: { U: UNDEFINED },
        }),
      ).toEqual({ anyOf: [{ type: 'string' }], $defs: { U: { not: {} } } })
    })

    it('removes properties accepting undefined from required', () => {
      expect(
        normalizeJsonSchema({
          type: 'object',
          properties: {
            a: { anyOf: [{ type: 'string' }, UNDEFINED] },
            b: UNDEFINED,
            c: { oneOf: [{ anyOf: [{ type: 'number' }, UNDEFINED] }, { type: 'null' }] },
            d: { type: 'string' },
            e: { anyOf: [{ type: 'string' }, { not: {} }] },
          },
          required: ['a', 'b', 'c', 'd', 'e', 'missing'],
        }),
      ).toEqual({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { not: {} },
          c: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          d: { type: 'string' },
          e: { type: 'string' },
        },
        required: ['d', 'e', 'missing'],
      })
    })

    it('removes required entirely when every property accepts undefined', () => {
      expect(
        normalizeJsonSchema({
          type: 'object',
          properties: { a: UNDEFINED },
          required: ['a'],
        }),
      ).toEqual({ type: 'object', properties: { a: { not: {} } } })
    })

    it('follows root-local refs, including chained and recursive ones', () => {
      expect(
        normalizeJsonSchema({
          $ref: '#/$defs/Root',
          $defs: {
            Root: {
              type: 'object',
              properties: {
                direct: { $ref: '#/$defs/U' },
                chained: { $ref: '#/$defs/Alias' },
                union: { $ref: '#/$defs/StringOrUndefined' },
                self: { $ref: '#/$defs/Root' },
                loop: { $ref: '#/$defs/Loop' },
              },
              required: ['direct', 'chained', 'union', 'self', 'loop'],
            },
            U: UNDEFINED,
            Alias: { $ref: '#/$defs/U' },
            StringOrUndefined: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/U' }] },
            Loop: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/Loop' }] },
          },
        }),
      ).toEqual({
        $ref: '#/$defs/Root',
        $defs: {
          Root: {
            type: 'object',
            properties: {
              direct: { $ref: '#/$defs/U' },
              chained: { $ref: '#/$defs/Alias' },
              union: { $ref: '#/$defs/StringOrUndefined' },
              self: { $ref: '#/$defs/Root' },
              loop: { $ref: '#/$defs/Loop' },
            },
            required: ['self', 'loop'],
          },
          U: { not: {} },
          Alias: { $ref: '#/$defs/U' },
          StringOrUndefined: { type: 'string' },
          Loop: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/Loop' }] },
        },
      })
    })

    it('keeps unmarked schemas matching nothing in required', () => {
      expect(
        normalizeJsonSchema({
          type: 'object',
          properties: { a: { not: {} } },
          required: ['a'],
        }),
      ).toEqual({ type: 'object', properties: { a: { not: {} } }, required: ['a'] })
    })
  })

  describe('non-finite values', () => {
    it.each<[string, JsonSchema, JsonSchema]>([
      ['const', { const: Infinity }, { not: {} }],
      ['enum', { enum: [1, Number.NaN] }, { enum: [1] }],
      [
        'an anyOf branch',
        { anyOf: [{ type: 'string' }, { const: -Infinity }] },
        { type: 'string' },
      ],
      [
        'a property',
        { type: 'object', properties: { a: { const: Infinity } }, required: ['a'] },
        { type: 'object', properties: { a: { not: {} } }, required: ['a'] },
      ],
      [
        'nested keywords',
        {
          prefixItems: [{ const: Infinity }],
          additionalProperties: { const: Infinity },
          patternProperties: { '^a': { const: Infinity } },
          dependentSchemas: { a: { const: Infinity } },
          not: { const: Infinity },
          if: { const: Infinity },
          // oxlint-disable-next-line unicorn/no-thenable
          then: { const: Infinity },
          else: { const: Infinity },
          $defs: { A: { const: Infinity } },
        },
        {
          prefixItems: [{ not: {} }],
          additionalProperties: { not: {} },
          patternProperties: { '^a': { not: {} } },
          dependentSchemas: { a: { not: {} } },
          not: { not: {} },
          if: { not: {} },
          // oxlint-disable-next-line unicorn/no-thenable
          then: { not: {} },
          else: { not: {} },
          $defs: { A: { not: {} } },
        },
      ],
    ])('replaces non-finite values in %s', (_, schema, expected) => {
      expect(normalizeJsonSchema(schema)).toEqual(expected)
    })

    it('keeps what a custom resolver returns as-is, so it cannot loop', () => {
      const resolved: JsonSchema = { anyOf: [{ const: Infinity }] }

      expect(
        normalizeJsonSchema(
          { properties: { a: { const: Infinity, description: 'a' } } },
          { resolveNonFiniteValue: () => resolved },
        ),
      ).toEqual({ properties: { a: { anyOf: [{ const: Infinity }], description: 'a' } } })
    })

    it('drops branches a resolver turns into schemas matching nothing', () => {
      expect(
        normalizeJsonSchema({ anyOf: [{ type: 'string' }, { const: Infinity, title: 'T' }] }),
      ).toEqual({ type: 'string' })
    })
  })

  it('does not treat const, enum or annotation values as schemas', () => {
    const schema: JsonSchema = {
      const: { anyOf: [UNDEFINED], x: Infinity },
      enum: [{ anyOf: [UNDEFINED] }],
      default: { const: Infinity },
      examples: [UNDEFINED],
    }

    expect(normalizeJsonSchema(schema)).toBe(schema)
  })

  it('keeps explicit schemas matching nothing outside unions', () => {
    const schema: JsonSchema = { type: 'array', items: false, not: { not: {} } }
    expect(normalizeJsonSchema(schema)).toBe(schema)
  })

  it('drops branches matching nothing from unions', () => {
    expect(normalizeJsonSchema({ anyOf: [{ type: 'string' }, false, { not: {} }] })).toEqual({
      type: 'string',
    })
  })

  it('returns schemas needing no change as-is, keeping unchanged sub-schemas', () => {
    const unchanged: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependencies: { a: ['b'] },
    }

    expect(normalizeJsonSchema(true)).toBe(true)
    expect(normalizeJsonSchema(unchanged)).toBe(unchanged)

    const nested = { type: 'number' } as const
    const result = normalizeJsonSchema({
      properties: { nested, changed: UNDEFINED },
    }) as any

    expect(result.properties.nested).toBe(nested)
    expect(result.properties.changed).toEqual({ not: {} })
  })

  it('does not mutate the input', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { anyOf: [{ const: Infinity }, UNDEFINED] } },
      required: ['a'],
    }
    const snapshot = structuredClone(schema)

    normalizeJsonSchema(schema)
    expect(schema).toEqual(snapshot)
  })
})
