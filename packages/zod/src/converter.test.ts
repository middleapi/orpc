import type { JSONSchema } from '@orpc/openapi'
import type { ZodTypeAny } from 'zod/v3'
import { z } from 'zod/v3'
import { ZodToJsonSchemaConverter } from './converter'
import { customJsonSchema } from './custom-json-schema'
import { blob } from './schemas/blob'
import { file } from './schemas/file'
import { regexp } from './schemas/regexp'
import { url } from './schemas/url'

type SchemaTestCase = {
  schema: ZodTypeAny
  input: [boolean, JSONSchema & Record<string, unknown>]
  output?: [boolean, JSONSchema & Record<string, unknown>]
}

const stringCases: SchemaTestCase[] = [
  {
    schema: z.string(),
    input: [true, { type: 'string' }],
  },
  {
    schema: z.string().min(5).max(10).regex(/^[a-z\\]+$/),
    input: [true, { type: 'string', maxLength: 10, minLength: 5, pattern: '^[a-z\\\\]+$' }],
  },
  {
    schema: z.string().base64(),
    input: [true, { type: 'string', contentEncoding: 'base64' }],
  },
  {
    schema: z.string().cuid(),
    input: [true, { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' }],
  },
  {
    schema: z.string().email(),
    input: [true, { type: 'string', format: 'email' }],
  },
  {
    schema: z.string().url(),
    input: [true, { type: 'string', format: 'uri' }],
  },
  {
    schema: z.string().uuid(),
    input: [true, { type: 'string', format: 'uuid' }],
  },
  {
    schema: z.string().length(6),
    input: [true, { type: 'string', minLength: 6, maxLength: 6 }],
  },
  {
    schema: z.string().includes('a\\'),
    input: [true, { type: 'string', pattern: 'a\\\\' }],
  },
  {
    schema: z.string().startsWith('a\\'),
    input: [true, { type: 'string', pattern: '^a\\\\' }],
  },
  {
    schema: z.string().endsWith('a\\'),
    input: [true, { type: 'string', pattern: 'a\\\\$' }],
  },
  {
    schema: z.string().emoji(),
    input: [true, { type: 'string', pattern: '^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$' }],
  },
  {
    schema: z.string().nanoid(),
    input: [true, { type: 'string', pattern: '^[a-zA-Z0-9_-]{21}$' }],
  },
  {
    schema: z.string().cuid2(),
    input: [true, { type: 'string', pattern: '^[0-9a-z]+$' }],
  },
  {
    schema: z.string().ulid(),
    input: [true, { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' }],
  },
  {
    schema: z.string().datetime(),
    input: [true, { type: 'string', format: 'date-time' }],
  },
  {
    schema: z.string().date(),
    input: [true, { type: 'string', format: 'date' }],
  },
  {
    schema: z.string().time(),
    input: [true, { type: 'string', format: 'time' }],
  },
  {
    schema: z.string().duration(),
    input: [true, { type: 'string', format: 'duration' }],
  },
  {
    schema: z.string().ip(),
    input: [true, { type: 'string', anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }] }],
  },
  {
    schema: z.string().ip({ version: 'v4' }),
    input: [true, { type: 'string', format: 'ipv4' }],
  },
  {
    schema: z.string().ip({ version: 'v6' }),
    input: [true, { type: 'string', format: 'ipv6' }],
  },
  {
    schema: z.string().jwt(),
    input: [true, { type: 'string', pattern: '^[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]+\\.[A-Za-z0-9-_]*$' }],
  },
  {
    schema: z.string().base64url(),
    input: [true, { type: 'string', pattern: '^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$' }],
  },
  {
    schema: z.string().trim(),
    input: [true, { type: 'string' }],
  },
]

const numberCases: SchemaTestCase[] = [
  {
    schema: z.number(),
    input: [true, { type: 'number' }],
  },
  {
    schema: z.number().int(),
    input: [true, { type: 'integer' }],
  },
  {
    schema: z.number().min(0).max(100).int(),
    input: [true, { type: 'integer', minimum: 0, maximum: 100 }],
  },
  {
    schema: z.number().multipleOf(5),
    input: [true, { type: 'number', multipleOf: 5 }],
  },
  {
    schema: z.number().finite(),
    input: [true, { type: 'number' }],
  },
  {
    schema: z.bigint(),
    input: [true, { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' }],
  },
  {
    schema: z.nan(),
    input: [true, { not: {} }],
    output: [true, { type: 'null' }],
  },
]

enum ExampleEnum {
  A = 'a',
  B = 'b',
}

const nativeCases: SchemaTestCase[] = [
  {
    schema: z.boolean(),
    input: [true, { type: 'boolean' }],
  },
  {
    schema: z.date(),
    input: [true, { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }],
  },
  {
    schema: z.null(),
    input: [true, { type: 'null' }],
  },
  {
    schema: z.any(),
    input: [false, { }],
  },
  {
    schema: z.unknown(),
    input: [false, {}],
  },
  {
    schema: z.undefined(),
    input: [false, { not: {} }],
  },
  {
    schema: z.void(),
    input: [false, { not: {} }],
  },
  {
    schema: z.literal(1234),
    input: [true, { const: 1234 }],
  },
  {
    schema: z.literal(undefined),
    input: [false, { not: {} }],
  },
  {
    schema: z.enum(['a', 'b']),
    input: [true, { enum: ['a', 'b'] }],
  },
  {
    schema: z.nativeEnum(ExampleEnum),
    input: [true, { enum: ['a', 'b'] }],
  },
]

const combinationCases: SchemaTestCase[] = [
  {
    schema: z.union([z.string(), z.number()]),
    input: [true, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    schema: z.union([z.string(), z.number().optional()]),
    input: [false, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    schema: z.union([z.string(), z.undefined()]),
    input: [false, { anyOf: [{ type: 'string' }] }],
  },
  {
    schema: z.intersection(z.string(), z.number()),
    input: [true, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    schema: z.intersection(z.string().optional(), z.number().optional()),
    input: [false, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
]

const processedCases: SchemaTestCase[] = [
  {
    schema: z.lazy(() => z.object({ value: z.string() })),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }],
  },
  {
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.string()) })),
    input: [true, { type: 'object', properties: { value: { } } }],
  },
  {
    schema: z.string().transform(x => x),
    input: [true, { type: 'string' }],
    output: [false, {}],
  },
  {
    schema: z.string().refine(x => x.length > 0, 'not empty'),
    input: [true, { type: 'string' }],
  },
  {
    schema: z.preprocess(x => x, z.string()),
    input: [true, { type: 'string' }],
  },
  {
    schema: z.number().catch(1),
    input: [true, { type: 'number' }],
  },
  {
    schema: z.number().brand<'CAT'>(),
    input: [true, { type: 'number' }],
  },
  {
    schema: z.number().brand<'CAT'>(),
    input: [true, { type: 'number' }],
  },
  {
    schema: z.pipeline(z.number(), z.string()),
    input: [true, { type: 'number' }],
    output: [true, { type: 'string' }],
  },
  {
    schema: z.string().nullable(),
    input: [true, { anyOf: [{ type: 'string' }, { type: 'null' }] }],
  },
  {
    schema: z.string().default('a'),
    input: [false, { default: 'a', type: 'string' }],
  },
  {
    schema: z.number().readonly(),
    input: [true, { type: 'number', readOnly: true }],
  },
]

const unsupportedCases: SchemaTestCase[] = [
  {
    schema: z.promise(z.string()),
    input: [true, { not: {} }],
  },
  {
    schema: z.symbol(),
    input: [true, { not: {} }],
  },
  {
    schema: z.function(),
    input: [true, { not: {} }],
  },
  {
    schema: z.never(),
    input: [true, { not: {} }],
  },
]

const extendSchemaCases: SchemaTestCase[] = [
  {
    schema: file(),
    input: [true, { type: 'string', contentMediaType: '*/*' }],
  },
  {
    schema: file().type('image/png'),
    input: [true, { type: 'string', contentMediaType: 'image/png' }],
  },
  {
    schema: blob(),
    input: [true, { type: 'string', contentMediaType: '*/*' }],
  },
  {
    schema: regexp(),
    input: [true, { 'type': 'string', 'pattern': '^\\/(.*)\\/([a-z]*)$', 'x-native-type': 'regexp' }],
  },
  {
    schema: url(),
    input: [true, { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }],
  },
  {
    schema: customJsonSchema(z.string(), { examples: ['a', 'b'] }),
    input: [true, { type: 'string', examples: ['a', 'b'] }],
  },
  {
    schema: customJsonSchema(
      customJsonSchema(
        customJsonSchema(z.string(), { examples: ['both'] }),
        { examples: ['input'] },
        { strategy: 'input' },
      ),
      { examples: ['output'] },
      { strategy: 'output' },
    ),
    input: [true, { type: 'string', examples: ['input'] }],
    output: [true, { type: 'string', examples: ['output'] }],
  },
  {
    schema: z.string().describe('description'),
    input: [true, { type: 'string', description: 'description' }],
  },
]

const edgeCases: SchemaTestCase[] = [
  {
    schema: z.array(z.string()).nonempty(),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 1 }],
  },
  {
    schema: z.array(z.string()).min(10).max(20),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 20 }],
  },
  {
    schema: z.array(z.string()).length(10),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 10 }],
  },
  {
    schema: z.object({ value: z.string() }).strict(),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }],
  },
  {
    schema: z.object({ value: z.string() }).catchall(z.number()),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: { type: 'number' } }],
  },
  {
    schema: z.record(z.number(), z.string()),
    input: [true, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { type: 'number' } }],
  },
  {
    schema: z.record(z.string().date(), z.string()),
    input: [true, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { type: 'string', format: 'date' } }],
  },
]

describe.each([
  ...stringCases,
  ...numberCases,
  ...nativeCases,
  ...combinationCases,
  ...processedCases,
  ...extendSchemaCases,
  ...unsupportedCases,
  ...edgeCases,
])('zodToJsonSchemaConverter.convert %#', ({ schema, input, output = input }) => {
  describe.each([
    ['input'],
    ['output'],
  ] as const)('strategy: %s', (strategy) => {
    const converter = new ZodToJsonSchemaConverter({ maxLazyDepth: 1 })

    const [expectedRequired, expectedJson] = strategy === 'input' ? input : output
    const arrayItemJsonSchema = expectedRequired
      ? expectedJson
      : strategy === 'input'
        ? { anyOf: [expectedJson, { not: {} }] }
        : { anyOf: [expectedJson, { type: 'null' }] }

    it('flat', () => {
      const [required, json] = converter.convert(schema, { strategy })

      expect(required).toEqual(expectedRequired)
      expect(json).toEqual(expectedJson)
    })

    it('object', () => {
      const testSchema = z.object({ value: schema })
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'object',
        properties: {
          value: expectedJson,
        },
        required: expectedRequired ? ['value'] : undefined,
      })
    })

    it('array', () => {
      const testSchema = z.array(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'array',
        items: arrayItemJsonSchema,
      })
    })

    it('tuple', () => {
      const testSchema = z.tuple([schema, schema]).rest(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'array',
        prefixItems: [
          arrayItemJsonSchema,
          arrayItemJsonSchema,
        ],
        items: arrayItemJsonSchema,
      })
    })

    it('set', () => {
      const testSchema = z.set(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        'type': 'array',
        'uniqueItems': true,
        'items': arrayItemJsonSchema,
        'x-native-type': 'set',
      })
    })

    it('map', () => {
      const testSchema = z.map(schema, schema.optional())
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        'type': 'array',
        'items': {
          type: 'array',
          maxItems: 2,
          minItems: 2,
          prefixItems: [
            arrayItemJsonSchema,
            { anyOf: [expectedJson, strategy === 'input' ? { not: {} } : { type: 'null' }] },
          ],
        },
        'x-native-type': 'map',
      })
    })

    it('record', () => {
      const testSchema = z.record(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'object',
        additionalProperties: expectedJson,
      })
    })
  })
})

it('zodToJsonSchemaConverter.condition', async () => {
  const converter = new ZodToJsonSchemaConverter()
  expect(converter.condition(z.string())).toBe(true)
  expect(converter.condition(z.string().optional())).toBe(true)

  const z4 = await import('zod/v4')
  expect(converter.condition(z4.string())).toBe(false)

  const v = await import('valibot')
  expect(converter.condition(v.string())).toBe(false)
})

it('works with recursive schemas', () => {
  function createSchema(depth: number): ZodTypeAny {
    if (depth <= 0) {
      return z.string()
    }
    return z.object({
      id: z.string(),
      name: z.string(),
      children: z.array(createSchema(depth - 1)).optional(),
    })
  }
  const converter = new ZodToJsonSchemaConverter()

  const [required, json] = converter.convert(createSchema(100), { strategy: 'input' })
  expect(required).toBe(true)
  expect(json).toEqual({
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      children: {
        type: 'array',
        items: expect.objectContaining({ type: 'object' }),
      },
    },
    required: ['id', 'name'],
  })
})
