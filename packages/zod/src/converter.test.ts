import type { JSONSchema } from '@orpc/openapi'
import type { ZodTypeAny } from 'zod'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ZodToJsonSchemaConverter } from './converter'
import { customJsonSchema } from './custom-json-schema'
import { blob } from './schemas/blob'
import { file } from './schemas/file'
import { regexp } from './schemas/regexp'
import { url } from './schemas/url'

type SchemaTestCase = {
  schema: ZodTypeAny
  input: [boolean, JSONSchema]
  output?: [boolean, JSONSchema]
  ignoreZodToJsonSchema?: boolean
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
    ignoreZodToJsonSchema: true,
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
    input: [true, { type: 'string', pattern: '^-?[0-9]+$' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.nan(),
    input: [true, { not: {} }],
    output: [true, { type: 'null' }],
    ignoreZodToJsonSchema: true,
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
    input: [true, { type: 'string', format: 'date-time' }],
  },
  {
    schema: z.null(),
    input: [true, { type: 'null' }],
  },
  {
    schema: z.any(),
    input: [false, { }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.unknown(),
    input: [false, {}],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.undefined(),
    input: [false, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.void(),
    input: [false, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.literal(1234),
    input: [true, { const: 1234 }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.literal(undefined),
    input: [false, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.enum(['a', 'b']),
    input: [true, { enum: ['a', 'b'] }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.nativeEnum(ExampleEnum),
    input: [true, { enum: ['a', 'b'] }],
    ignoreZodToJsonSchema: true,
  },
]

const combinationCases: SchemaTestCase[] = [
  {
    schema: z.union([z.string(), z.number()]),
    input: [true, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.union([z.string(), z.number().optional()]),
    input: [false, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.union([z.string(), z.undefined()]),
    input: [false, { type: 'string' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.intersection(z.string(), z.number()),
    input: [true, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    schema: z.intersection(z.string().optional(), z.number().optional()),
    input: [false, { allOf: [{ type: 'string' }, { type: 'number' }] }],
    ignoreZodToJsonSchema: true,
  },
]

const processedCases: SchemaTestCase[] = [
  {
    schema: z.lazy(() => z.object({ value: z.string() })),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.string()) })),
    input: [true, { type: 'object', properties: { value: { } } }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.string().transform(x => x),
    input: [true, { type: 'string' }],
    output: [false, {}],
    ignoreZodToJsonSchema: true,
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
    ignoreZodToJsonSchema: true,
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
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.string().default('a'),
    input: [false, { default: 'a', type: 'string' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.number().readonly(),
    input: [true, { type: 'number', readOnly: true }],
    ignoreZodToJsonSchema: true,
  },
]

const unsupportedCases: SchemaTestCase[] = [
  {
    schema: z.promise(z.string()),
    input: [true, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.symbol(),
    input: [true, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.function(),
    input: [true, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.never(),
    input: [true, { not: {} }],
    ignoreZodToJsonSchema: true,
  },
]

const extendSchemaCases: SchemaTestCase[] = [
  {
    schema: file(),
    input: [true, { type: 'string', contentMediaType: '*/*' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: file().type('image/png'),
    input: [true, { type: 'string', contentMediaType: 'image/png' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: blob(),
    input: [true, { type: 'string', contentMediaType: '*/*' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: regexp(),
    input: [true, { type: 'string', pattern: '^\\/(.*)\\/([a-z]*)$' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: url(),
    input: [true, { type: 'string', format: 'uri' }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: customJsonSchema(z.string(), { examples: ['a', 'b'] }),
    input: [true, { type: 'string', examples: ['a', 'b'] }],
    ignoreZodToJsonSchema: true,
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
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.string().describe('description'),
    input: [true, { type: 'string', description: 'description' }],
    ignoreZodToJsonSchema: true,
  },
]

const edgeCases: SchemaTestCase[] = [
  {
    schema: z.array(z.string()).nonempty(),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 1 }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.array(z.string()).min(10).max(20),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 20 }],
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.array(z.string()).length(10),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 10 }],
    ignoreZodToJsonSchema: true,
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
    ignoreZodToJsonSchema: true,
  },
  {
    schema: z.record(z.string().date(), z.string()),
    input: [true, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { type: 'string', format: 'date' } }],
    ignoreZodToJsonSchema: true,
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
])('zodToJsonSchemaConverter.convert %#', ({ schema, input, output = input, ignoreZodToJsonSchema }) => {
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

      if (!ignoreZodToJsonSchema) {
        if (expectedRequired) {
          expect(expectedJson).toEqual({
            ...zodToJsonSchema(schema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
            $schema: undefined,
          })
        }
        else {
          expect({
            anyOf: [{ not: {} }, expectedJson],
          }).toEqual({
            ...zodToJsonSchema(schema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
            $schema: undefined,
          })
        }
      }
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

      if (!ignoreZodToJsonSchema) {
        expect(json).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
          additionalProperties: undefined,
        })
      }
    })

    it('array', () => {
      const testSchema = z.array(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'array',
        items: arrayItemJsonSchema,
      })

      if (!ignoreZodToJsonSchema) {
        expect(json).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
        })
      }
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

      if (!ignoreZodToJsonSchema) {
        expect({
          type: 'array',
          items: [
            expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
            expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
          ],
          additionalItems: expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
        }).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
          maxItems: undefined,
          minItems: undefined,
        })
      }
    })

    it('set', () => {
      const testSchema = z.set(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'array',
        uniqueItems: true,
        items: arrayItemJsonSchema,
      })

      if (!ignoreZodToJsonSchema) {
        expect({
          type: 'array',
          uniqueItems: true,
          items: expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
        }).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
        })
      }
    })

    it('map', () => {
      const testSchema = z.map(schema, schema.optional())
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'array',
        items: {
          type: 'array',
          maxItems: 2,
          minItems: 2,
          prefixItems: [
            arrayItemJsonSchema,
            { anyOf: [expectedJson, strategy === 'input' ? { not: {} } : { type: 'null' }] },
          ],
        },
      })

      if (!ignoreZodToJsonSchema) {
        expect({
          type: 'array',
          items: {
            maxItems: 2,
            minItems: 2,
            items: [
              expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
              { anyOf: [{ not: {} }, expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] }] },
            ],
            type: 'array',
          },
        }).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
          maxItems: undefined,
        })
      }
    })

    it('record', () => {
      const testSchema = z.record(schema)
      const [required, json] = converter.convert(testSchema, { strategy })

      expect(required).toEqual(true)
      expect(json).toEqual({
        type: 'object',
        additionalProperties: expectedJson,
      })

      if (!ignoreZodToJsonSchema) {
        expect({
          type: 'object',
          additionalProperties: expectedRequired ? expectedJson : { anyOf: [{ not: {} }, expectedJson] },
        }).toEqual({
          ...zodToJsonSchema(testSchema, { target: 'jsonSchema2019-09', pipeStrategy: strategy, $refStrategy: 'none' }),
          $schema: undefined,
          maxItems: undefined,
        })
      }
    })
  })
})

it('zodToJsonSchemaConverter.condition', async () => {
  const converter = new ZodToJsonSchemaConverter()
  expect(converter.condition(z.string())).toBe(true)
  expect(converter.condition(z.string().optional())).toBe(true)

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
