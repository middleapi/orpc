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
      ['effect vendor without an effect schema', { '~standard': { version: 1, vendor: 'effect', validate: () => ({ value: 1 }) } } as const, false],
    ] as const)('matches %s', (_, schema, expected) => {
      expect(converter.condition(schema, 'input')).toBe(expected)
    })
  })

  it.each([
    ['input', { type: 'string' }],
    ['output', { anyOf: [{ type: 'number' }, { type: 'string', enum: ['Infinity', '-Infinity', 'NaN'] }] }],
  ] as const)('uses the requested %s direction', (direction, jsonSchema) => {
    expect(converter.convert(toStandardSchema(Schema.NumberFromString), direction)).toEqual([jsonSchema, false])
  })

  it('does not mutate the schema', () => {
    const schema = toStandardSchema(Schema.String)
    converter.convert(schema, 'input')
    expect('jsonSchema' in schema['~standard']).toBe(false)
  })

  describe('options', () => {
    const schema = toStandardSchema(Schema.Struct({ name: Schema.String.annotate({ 'x-custom': 'value', 'identifier': 'Name' }) }))

    it('forwards onExcessProperty', () => {
      expect(new EffectSchemaToJsonSchemaConverter({ onExcessProperty: 'error' }).convert(toStandardSchema(Schema.Struct({ a: Schema.String })), 'input')).toEqual([{
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      }, false])
    })

    it('forwards includeAnnotationKey', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ includeAnnotationKey: key => key === 'x-custom' })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'object',
        properties: { name: { $ref: '#/$defs/Name' } },
        required: ['name'],
        additionalProperties: true,
        $defs: { Name: { 'type': 'string', 'x-custom': 'value' } },
      }, false])
    })

    it('forwards referencePolicy', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ referencePolicy: () => undefined })

      expect(converter.convert(schema, 'input')).toEqual([{
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: true,
      }, false])
    })

    it('forwards generateDescriptions', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ generateDescriptions: true })

      const schema = toStandardSchema(Schema.String.check(Schema.isMinLength(2)))

      expect(converter.convert(schema, 'input')[0]).toHaveProperty('description', 'a value with a length of at least 2')
      expect(new EffectSchemaToJsonSchemaConverter().convert(schema, 'input')[0]).not.toHaveProperty('description')
    })
  })

  describe('definitions', () => {
    it('places definitions in $defs at the root', () => {
      const schema = toStandardSchema(Schema.Struct({ a: Schema.String }).annotate({ identifier: 'Root' }))

      expect(converter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/Root',
        $defs: {
          Root: {
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a'],
            additionalProperties: true,
          },
        },
      }, false])
    })

    it.each(['input', 'output'] as const)('keeps class definitions in the %s direction', (direction) => {
      class Planet extends Schema.Class<Planet>('Planet')({ name: Schema.String }) {}

      expect(converter.convert(toStandardSchema(Planet), direction)).toEqual([{
        $ref: '#/$defs/PlanetEncoded',
        $defs: {
          PlanetEncoded: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: true,
          },
        },
      }, false])
    })

    it('resolves recursion into a $ref', () => {
      interface Category {
        readonly name: string
        readonly children: ReadonlyArray<Category>
      }

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
  })

  describe('optionality', () => {
    it.each([
      ['defaulted input schema', Schema.UndefinedOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed('fallback'))), 'input', true],
      ['defaulted output schema', Schema.UndefinedOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed('fallback'))), 'output', false],
      ['undefined-producing output schema', Schema.UndefinedOr(Schema.String), 'output', true],
      ['unknown input schema', Schema.Unknown, 'input', true],
      ['required input schema', Schema.String, 'input', false],
      ['required output schema', Schema.String, 'output', false],
    ] as const)('marks %s correctly', (_, schema, direction, optional) => {
      expect(converter.convert(toStandardSchema(schema), direction)).toEqual([expect.any(Object), optional])
    })

    it('marks as required if standard validation throws', () => {
      const schema = toStandardSchema(Schema.Unknown)
      ;(schema as any)['~standard'].validate = () => {
        throw new Error('test')
      }

      expect(converter.convert(schema, 'input')).toEqual([{}, false])
    })
  })

  it('falls back to an empty optional schema when conversion throws', () => {
    // Effect cannot represent symbol property names in JSON Schema
    const schema = toStandardSchema(Schema.Struct({ [Symbol.for('key')]: Schema.String }))

    expect(converter.convert(schema, 'input')).toEqual([{}, true])
  })

  describe('cache option', () => {
    it('reuses conversion results per schema and direction when enabled', () => {
      const converter = new EffectSchemaToJsonSchemaConverter({ cache: true })
      const schema = toStandardSchema(Schema.NumberFromString)

      const input = converter.convert(schema, 'input')
      expect(input).toEqual([{ type: 'string' }, false])
      expect(converter.convert(schema, 'input')).toBe(input)

      const output = converter.convert(schema, 'output')
      expect(output).not.toBe(input)
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
