import { Effect, Schema } from 'effect'
import { z } from 'zod'
import { EffectSchemaToJsonSchemaConverter } from './converter'
import { toStandardSchema } from './schema'

describe('effectSchemaToJsonSchemaConverter', () => {
  const converter = new EffectSchemaToJsonSchemaConverter()

  describe('.condition', () => {
    it.each([
      ['effect schema', toStandardSchema(Schema.String), true],
      ['non-effect schema', z.string(), false],
      ['undefined schema', undefined, false],
      ['effect vendor without an effect schema', { '~standard': { version: 1, vendor: 'effect', validate: () => ({ value: 1 }) } }, false],
    ] as const)('matches %s', (_, schema, expected) => {
      expect(converter.condition(schema, 'input')).toBe(expected)
    })
  })

  it.each([
    ['input', { type: 'string' }],
    ['output', { type: 'number' }],
  ] as const)('uses the requested %s direction', (direction, jsonSchema) => {
    expect(converter.convert(toStandardSchema(Schema.NumberFromString), direction)).toEqual([jsonSchema, false])
  })

  it('does not mutate the schema', () => {
    const schema = toStandardSchema(Schema.String)
    converter.convert(schema, 'input')
    expect('jsonSchema' in schema['~standard']).toBe(false)
  })

  it.each([
    ['onExcessProperty', { onExcessProperty: 'error' }, Schema.Struct({ a: Schema.String }), { additionalProperties: false }],
    ['includeAnnotationKey', { includeAnnotationKey: (key: string) => key === 'x-custom' }, Schema.String.annotate({ 'x-custom': 'value' }), { 'x-custom': 'value' }],
    ['referencePolicy', { referencePolicy: () => undefined }, Schema.Struct({ a: Schema.String.annotate({ identifier: 'A' }) }), { properties: { a: { type: 'string' } } }],
    ['generateDescriptions', { generateDescriptions: true }, Schema.String.check(Schema.isMinLength(2)), { description: 'a value with a length of at least 2' }],
  ] as const)('forwards the %s option to Effect', (_, options, schema, expected) => {
    const converter = new EffectSchemaToJsonSchemaConverter({ cache: true, ...options })
    expect(converter.convert(toStandardSchema(schema), 'input')[0]).toMatchObject(expected)
  })

  describe('validated values', () => {
    it.each([
      [
        'optional properties without null',
        Schema.Struct({ a: Schema.optional(Schema.String), b: Schema.optionalKey(Schema.Number) }),
        { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, additionalProperties: true },
      ],
      [
        'undefined-or properties without null',
        Schema.Struct({ a: Schema.UndefinedOr(Schema.String) }),
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: true },
      ],
      ['optional schemas without null', Schema.optional(Schema.String), { type: 'string' }],
      ['nullish schemas with a single null', Schema.NullishOr(Schema.String), { anyOf: [{ type: 'string' }, { type: 'null' }] }],
      ['optional literals', Schema.optional(Schema.Literals(['a', 'b'])), { type: 'string', enum: ['a', 'b'] }],
      [
        'annotated undefined-or schemas',
        Schema.UndefinedOr(Schema.String.check(Schema.isMaxLength(3))).annotate({ description: 'name' }),
        { type: 'string', maxLength: 3, description: 'name' },
      ],
      [
        'optional tuple elements without null',
        Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]),
        { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 1, maxItems: 2 },
      ],
      ['undefined', Schema.Undefined, {}],
      ['void', Schema.Void, {}],
      ['undefined-only unions', Schema.Union([Schema.Undefined, Schema.Void]), {}],
      ['numbers without NaN and Infinity strings', Schema.Number, { type: 'number' }],
      ['numbers in unions', Schema.Union([Schema.Number, Schema.String]), { anyOf: [{ type: 'number' }, { type: 'string' }] }],
      ['symbols', Schema.Struct({ a: Schema.Symbol }), { type: 'object', properties: { a: {} }, required: ['a'], additionalProperties: true }],
      ['options', Schema.Option(Schema.String), {}],
      ['durations', Schema.Duration, {}],
      ['Uint8Arrays', Schema.Uint8Array, {}],
    ])('converts %s', (_, schema, jsonSchema) => {
      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual(jsonSchema)
      expect(converter.convert(toStandardSchema(schema), 'output')[0]).toEqual(jsonSchema)
    })

    it('wraps references in undefined-or schemas that carry annotations', () => {
      const schema = Schema.UndefinedOr(Schema.String.annotate({ identifier: 'Name' })).annotate({ description: 'name' })

      expect(converter.convert(toStandardSchema(schema), 'input')).toEqual([{
        $ref: '#/$defs/Name',
        description: 'name',
        $defs: { Name: { type: 'string' } },
      }, true])
    })

    it('agrees with validation on the null and NaN values Effect JSON Schema accepts', () => {
      const schema = toStandardSchema(Schema.Struct({ a: Schema.optional(Schema.String), b: Schema.Number }))

      expect(schema['~standard'].validate({ a: null, b: 1 })).toEqual({ issues: [expect.objectContaining({ path: ['a'] })] })
      expect(schema['~standard'].validate({ b: 'NaN' })).toEqual({ issues: [expect.objectContaining({ path: ['b'] })] })
      expect(converter.convert(schema, 'input')[0]).toEqual({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['b'],
        additionalProperties: true,
      })
    })
  })

  describe('native type extensions', () => {
    it.each([
      ['Schema.Date', Schema.Date, { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }],
      ['Schema.BigInt', Schema.BigInt, { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' }],
      ['bigint literals', Schema.Literal(1n), { 'type': 'string', 'enum': ['1'], 'x-native-type': 'bigint' }],
      ['Schema.URL', Schema.URL, { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }],
      ['Schema.File', Schema.File, { type: 'string', format: 'binary', contentEncoding: 'binary' }],
      ['Schema.ReadonlySet', Schema.ReadonlySet(Schema.String), {
        'type': 'array',
        'uniqueItems': true,
        'items': { type: 'string' },
        'x-native-type': 'set',
      }],
      ['Schema.ReadonlyMap', Schema.ReadonlyMap(Schema.String, Schema.Number), {
        'type': 'array',
        'items': {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          maxItems: 2,
          minItems: 2,
        },
        'x-native-type': 'map',
      }],
    ])('extends conversion for %s', (_, schema, jsonSchema) => {
      expect(converter.convert(toStandardSchema(schema), 'input')).toEqual([jsonSchema, false])
      expect(converter.convert(toStandardSchema(schema), 'output')).toEqual([jsonSchema, false])
    })

    it('describes the decoded side of string codecs in the output direction', () => {
      const schema = toStandardSchema(Schema.Struct({ at: Schema.DateFromString, url: Schema.URLFromString }))

      expect(converter.convert(schema, 'input')[0]).toMatchObject({
        properties: { at: { type: 'string' }, url: { type: 'string' } },
      })
      expect(converter.convert(schema, 'output')[0]).toMatchObject({
        properties: {
          at: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          url: { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
        },
      })
    })

    it('converts set and map items', () => {
      const schema = Schema.ReadonlyMap(Schema.Date, Schema.ReadonlySet(Schema.optional(Schema.BigInt)))

      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual({
        'type': 'array',
        'items': {
          type: 'array',
          prefixItems: [
            { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
            {
              'type': 'array',
              'uniqueItems': true,
              'items': { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
              'x-native-type': 'set',
            },
          ],
          maxItems: 2,
          minItems: 2,
        },
        'x-native-type': 'map',
      })
    })

    it('emits x-native-type alongside the includeAnnotationKey option', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ includeAnnotationKey: key => key === 'x-custom' })

      expect(converter.convert(toStandardSchema(Schema.Date.annotate({ 'x-custom': 'value' })), 'input')[0]).toEqual({
        'type': 'string',
        'format': 'date-time',
        'x-native-type': 'date',
        'x-custom': 'value',
      })
    })
  })

  describe('metadata', () => {
    it.each([
      [
        'numbers',
        Schema.Number.check(Schema.isGreaterThan(0)).annotate({ description: 'positive' }),
        { type: 'number', exclusiveMinimum: 0, description: 'positive' },
      ],
      [
        'multiples',
        Schema.Number.check(Schema.isMultipleOf(2)).annotate({ examples: [2] }),
        { type: 'number', multipleOf: 2, examples: [2] },
      ],
      [
        'dates',
        Schema.Date.annotate({ title: 'At', description: 'timestamp' }),
        { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date', 'title': 'At', 'description': 'timestamp' },
      ],
      [
        'bigints',
        Schema.BigInt.annotate({ description: 'big' }),
        { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint', 'description': 'big' },
      ],
      [
        'sets',
        Schema.ReadonlySet(Schema.String).annotate({ description: 'tags' }),
        { 'type': 'array', 'uniqueItems': true, 'items': { type: 'string' }, 'x-native-type': 'set', 'description': 'tags' },
      ],
    ])('keeps annotations and checks on %s', (_, schema, jsonSchema) => {
      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual(jsonSchema)
    })

    it.each([
      ['isMinLength', Schema.String.check(Schema.isMinLength(2)), { type: 'string', minLength: 2 }],
      ['isBetweenLength', Schema.String.check(Schema.isBetweenLength(3, 5)), { type: 'string', minLength: 3, maxLength: 5 }],
      ['grouped checks', Schema.String.check(Schema.makeFilterGroup([Schema.isMinLength(4)])), { type: 'string', allOf: [{ minLength: 4 }] }],
      ['arrays', Schema.Array(Schema.String).check(Schema.isMinLength(2)), { type: 'array', items: { type: 'string' }, minItems: 2 }],
    ])('emits the exact minimum length for %s', (_, schema, jsonSchema) => {
      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual(jsonSchema)
    })
  })

  describe('definitions', () => {
    class Planet extends Schema.Class<Planet>('Planet')({
      name: Schema.String,
      radius: Schema.NumberFromString,
    }, { description: 'A planet' }) {}

    it.each([
      ['input', { name: { type: 'string' }, radius: { type: 'string' } }, {}],
      ['output', { name: { type: 'string' }, radius: { type: 'number' } }, { description: 'A planet' }],
    ] as const)('keeps class definitions in the %s direction', (direction, properties, annotations) => {
      expect(converter.convert(toStandardSchema(Planet), direction)).toEqual([{
        $ref: '#/$defs/Planet',
        $defs: {
          Planet: {
            type: 'object',
            properties,
            required: ['name', 'radius'],
            additionalProperties: true,
            ...annotations,
          },
        },
      }, false])
    })

    it.each(['input', 'output'] as const)('names definitions inherited from the decoded side without an Encoded suffix in the %s direction', (direction) => {
      const schema = toStandardSchema(Schema.Struct({ amount: Schema.NumberFromString.annotate({ identifier: 'Amount' }) }))

      expect(converter.convert(schema, direction)[0]).toMatchObject({
        properties: { amount: { $ref: '#/$defs/Amount' } },
        $defs: { Amount: { type: direction === 'input' ? 'string' : 'number' } },
      })
    })

    it('keeps identifiers that end with Encoded', () => {
      expect(converter.convert(toStandardSchema(Schema.String.annotate({ identifier: 'NameEncoded' })), 'input')[0]).toEqual({
        $ref: '#/$defs/NameEncoded',
        $defs: { NameEncoded: { type: 'string' } },
      })
    })

    it('passes identifiers without the Encoded suffix to the referencePolicy option', () => {
      const referencePolicy = vi.fn(({ identifier }: { identifier: string | undefined }) => identifier && `${identifier}Ref`)
      const converter = new EffectSchemaToJsonSchemaConverter({ referencePolicy })

      expect(converter.convert(toStandardSchema(Planet), 'input')[0]).toMatchObject({
        $ref: '#/$defs/PlanetRef',
        $defs: { PlanetRef: { type: 'object' } },
      })
      expect(referencePolicy).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'Planet' }))
    })

    it('suffixes distinct definitions that share an identifier', () => {
      const schema = Schema.Struct({
        a: Schema.String.annotate({ identifier: 'Value' }),
        b: Schema.Number.annotate({ identifier: 'Value' }),
        c: Schema.Boolean.annotate({ identifier: 'Value2' }),
      })

      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual({
        type: 'object',
        properties: {
          a: { $ref: '#/$defs/Value' },
          b: { $ref: '#/$defs/Value2' },
          c: { $ref: '#/$defs/Value22' },
        },
        required: ['a', 'b', 'c'],
        additionalProperties: true,
        $defs: {
          Value: { type: 'string' },
          Value2: { type: 'number' },
          Value22: { type: 'boolean' },
        },
      })
    })

    it('references definitions with plain JSON pointers', () => {
      const schema = Schema.Struct({ a: Schema.String.annotate({ identifier: 'Planet name/é%' }) })

      expect(converter.convert(toStandardSchema(schema), 'input')[0]).toEqual({
        type: 'object',
        properties: { a: { $ref: '#/$defs/Planet name~1é%' } },
        required: ['a'],
        additionalProperties: true,
        $defs: { 'Planet name/é%': { type: 'string' } },
      })
    })

    it('drops definitions that are only used by unconstrained declarations', () => {
      expect(converter.convert(toStandardSchema(Schema.Option(Planet)), 'output')).toEqual([{}, false])
    })

    interface Category {
      readonly name: string
      readonly children: ReadonlyArray<Category>
    }

    it('resolves recursion into a $ref', () => {
      const CategorySchema: Schema.Codec<Category> = Schema.Struct({
        name: Schema.String,
        children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => CategorySchema)),
      }).annotate({ identifier: 'Category' })

      expect(converter.convert(toStandardSchema(CategorySchema), 'input')).toEqual([{
        $ref: '#/$defs/Category',
        $defs: {
          Category: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/$defs/Category' } },
            },
            required: ['name', 'children'],
            additionalProperties: true,
          },
        },
      }, false])
    })

    it('names anonymous recursive definitions like the other converters', () => {
      const CategorySchema: Schema.Codec<Category> = Schema.Struct({
        name: Schema.String,
        children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => CategorySchema)),
      })

      expect(converter.convert(toStandardSchema(Schema.Struct({ root: CategorySchema, __schema0: Schema.String.annotate({ identifier: '__schema0' }) })), 'input')[0]).toEqual({
        type: 'object',
        properties: {
          root: { $ref: '#/$defs/__schema1' },
          __schema0: { $ref: '#/$defs/__schema0' },
        },
        required: ['root', '__schema0'],
        additionalProperties: true,
        $defs: {
          __schema0: { type: 'string' },
          __schema1: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/$defs/__schema1' } },
            },
            required: ['name', 'children'],
            additionalProperties: true,
          },
        },
      })
    })
  })

  describe('records', () => {
    it('selects number keys with numeric strings', () => {
      expect(converter.convert(toStandardSchema(Schema.Record(Schema.Number, Schema.Date)), 'input')[0]).toEqual({
        type: 'object',
        patternProperties: {
          '^[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?$': { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
        },
        additionalProperties: true,
      })
    })

    it('leaves symbol keys unconstrained', () => {
      expect(converter.convert(toStandardSchema(Schema.Record(Schema.Symbol, Schema.String)), 'input')[0]).toEqual({
        type: 'object',
        additionalProperties: true,
      })
    })
  })

  describe('optionality', () => {
    const Defaulted = Schema.UndefinedOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed('fallback')))

    it.each([
      ['defaulted input schema', Defaulted, 'input', true],
      ['defaulted output schema', Defaulted, 'output', false],
      ['undefined-producing output schema', Schema.UndefinedOr(Schema.String), 'output', true],
      ['unknown input schema', Schema.Unknown, 'input', true],
      ['required input schema', Schema.String, 'input', false],
      ['required output schema', Schema.String, 'output', false],
    ] as const)('marks %s correctly', (_, schema, direction, optional) => {
      expect(converter.convert(toStandardSchema(schema), direction)).toEqual([expect.any(Object), optional])
    })

    it('marks as required if standard validation throws', () => {
      // `annotate` returns a fresh instance, so the shared `Schema.Unknown` is left untouched
      const schema = toStandardSchema(Schema.Unknown.annotate({}))
      ;(schema as any)['~standard'].validate = () => {
        throw new Error('test')
      }

      expect(converter.convert(schema, 'input')).toEqual([{}, false])
    })
  })

  it('propagates errors from Effect', () => {
    // Effect cannot represent symbol property names in JSON Schema
    const schema = toStandardSchema(Schema.Struct({ [Symbol.for('key')]: Schema.String }))

    expect(() => converter.convert(schema, 'input')).toThrow('Invalid schema representation document')
  })

  describe('cache option', () => {
    it('reuses conversion results per schema and direction when enabled', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ cache: true })
      const schema = toStandardSchema(Schema.NumberFromString)

      const input = converter.convert(schema, 'input')
      expect(input).toEqual([{ type: 'string' }, false])
      expect(converter.convert(schema, 'input')).toBe(input)

      const output = converter.convert(schema, 'output')
      expect(output).toEqual([{ type: 'number' }, false])
      expect(converter.convert(schema, 'output')).toBe(output)
    })

    it('converts on every call when disabled', () => {
      const schema = toStandardSchema(Schema.NumberFromString)

      const first = converter.convert(schema, 'input')
      const second = converter.convert(schema, 'input')

      expect(second).toEqual(first)
      expect(second).not.toBe(first)
    })
  })
})
