import { oz } from '@orpc/zod'
import { Format } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchema } from './converter'

describe('primitive types', () => {
  it('should convert string schema', () => {
    const schema = z.string()
    expect(zodToJsonSchema(schema)).toEqual({ type: 'string' })
  })

  it('should convert string schema with constraints', () => {
    const schema = z
      .string()
      .min(5)
      .max(10)
      .email()
      .regex(/^[a-z]+$/)

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'string',
      minLength: 5,
      maxLength: 10,
      format: Format.Email,
      pattern: '^[a-z]+$',
    })
  })

  it('should convert number schema', () => {
    const schema = z.number()
    expect(zodToJsonSchema(schema)).toEqual({ type: 'number' })
  })

  it('should convert number schema with constraints', () => {
    const schema = z.number().int().min(0).max(100).multipleOf(5)

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'integer',
      minimum: 0,
      maximum: 100,
      multipleOf: 5,
    })
  })

  it('should convert boolean schema', () => {
    const schema = z.boolean()
    expect(zodToJsonSchema(schema)).toEqual({ type: 'boolean' })
  })

  it('should convert null schema', () => {
    const schema = z.null()
    expect(zodToJsonSchema(schema)).toEqual({ type: 'null' })
  })

  it('should convert undefined schema', () => {
    const schema = z.undefined()
    expect(zodToJsonSchema(schema)).toEqual({ const: 'undefined' })
  })

  it('should convert literal schema', () => {
    const schema = z.literal('hello')
    expect(zodToJsonSchema(schema)).toEqual({ const: 'hello' })
  })
})

describe('array types', () => {
  it('should convert array schema', () => {
    const schema = z.array(z.string())
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('should convert array schema with length constraints', () => {
    const schema = z.array(z.string()).min(1).max(5)
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'array',
      items: {
        type: 'string',
      },
      minItems: 1,
      maxItems: 5,
    })
  })

  it('should convert tuple schema', () => {
    const schema = z.tuple([z.string(), z.number()])
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
    })
  })
})

describe('object types', () => {
  it('should convert object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
    })

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        email: { type: 'string', format: Format.Email },
      },
      required: ['name', 'age', 'email'],
    })
  })

  it('should handle optional properties', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    })

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    })
  })

  it('should convert record schema', () => {
    const schema = z.record(z.string(), z.number())
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    })
  })
})

describe('union and intersection types', () => {
  it('should convert union schema', () => {
    const schema = z.union([z.string(), z.number()])
    expect(zodToJsonSchema(schema)).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    })
  })

  it('should convert discriminated union schema', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), value: z.number() }),
    ])

    expect(zodToJsonSchema(schema)).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { const: 'a' },
            value: { type: 'string' },
          },
          required: ['type', 'value'],
        },
        {
          type: 'object',
          properties: {
            type: { const: 'b' },
            value: { type: 'number' },
          },
          required: ['type', 'value'],
        },
      ],
    })
  })

  it('should convert intersection schema', () => {
    const schema = z.intersection(
      z.object({ name: z.string() }),
      z.object({ age: z.number() }),
    )

    expect(zodToJsonSchema(schema)).toEqual({
      allOf: [
        {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        {
          type: 'object',
          properties: { age: { type: 'number' } },
          required: ['age'],
        },
      ],
    })
  })
})

describe('modifiers', () => {
  it('should convert optional schema', () => {
    const schema = z.string().optional()
    expect(zodToJsonSchema(schema)).toEqual({
      anyOf: [{ const: 'undefined' }, { type: 'string' }],
    })
  })

  it('should convert nullable schema', () => {
    const schema = z.string().nullable()
    expect(zodToJsonSchema(schema)).toEqual({
      anyOf: [{ type: 'null' }, { type: 'string' }],
    })
  })

  it('should convert readonly schema', () => {
    const schema = z.string().readonly()
    expect(zodToJsonSchema(schema)).toEqual({ type: 'string' })
  })
})

describe('special types', () => {
  it('should convert date schema', () => {
    const schema = z.date()
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'string',
      format: Format.Date,
    })
  })

  it('should convert enum schema', () => {
    const schema = z.enum(['A', 'B', 'C'])
    expect(zodToJsonSchema(schema)).toEqual({
      enum: ['A', 'B', 'C'],
    })
  })

  it('should convert native enum schema', () => {
    enum TestEnum {
      A = 'A',
      B = 'B',
    }
    const schema = z.nativeEnum(TestEnum)
    expect(zodToJsonSchema(schema)).toEqual({
      enum: ['A', 'B'],
    })
  })
})

describe('transform and effects', () => {
  it('should handle transform effects based on mode', () => {
    const schema = z.string().transform(val => val.length)

    expect(zodToJsonSchema(schema, { mode: 'input' })).toEqual({
      type: 'string',
    })

    expect(zodToJsonSchema(schema, { mode: 'output' })).toEqual({})
  })
})

describe('lazy types', () => {
  it('should handle lazy types with depth limit', () => {
    type Tree = {
      value: string
      children?: Tree[]
    }

    const treeSchema: z.ZodType<Tree> = z.lazy(() =>
      z.object({
        value: z.string(),
        children: z.array(treeSchema).optional(),
      }),
    )

    const tree1 = {
      type: 'object',
      properties: {
        value: { type: 'string' },
        children: {
          type: 'array',
          items: {},
        },
      },
      required: ['value'],
    }
    const tree2 = {
      type: 'object',
      properties: {
        value: { type: 'string' },
        children: {
          type: 'array',
          items: tree1,
        },
      },
      required: ['value'],
    }

    expect(zodToJsonSchema(treeSchema, { maxLazyDepth: 2 })).toEqual({
      type: 'object',
      properties: {
        value: { type: 'string' },
        children: {
          type: 'array',
          items: tree2,
        },
      },
      required: ['value'],
    })
  })
})

describe('with custom json schema', () => {
  const schema = oz.openapi(z.object({}), {
    examples: [{ a: '23' }],
  })

  const schema2 = oz.openapi(
    z.object({}),
    {
      examples: [{ a: '23' }, { b: '23' }],
    },
    { mode: 'input' },
  )

  const schema3 = oz.openapi(
    z.object({}),
    {
      examples: [{ a: '23' }, { b: '23' }],
    },
    { mode: 'output' },
  )

  it('works with input mode', () => {
    expect(zodToJsonSchema(schema, { mode: 'input' })).toEqual({
      type: 'object',
      examples: [{ a: '23' }],
    })

    expect(zodToJsonSchema(schema2, { mode: 'input' })).toEqual({
      type: 'object',
      examples: [{ a: '23' }, { b: '23' }],
    })

    expect(zodToJsonSchema(schema3, { mode: 'input' })).toEqual({
      type: 'object',
    })
  })

  it('works with output mode', () => {
    expect(zodToJsonSchema(schema, { mode: 'output' })).toEqual({
      type: 'object',
      examples: [{ a: '23' }],
    })

    expect(zodToJsonSchema(schema2, { mode: 'output' })).toEqual({
      type: 'object',
    })

    expect(zodToJsonSchema(schema3, { mode: 'output' })).toEqual({
      type: 'object',
      examples: [{ a: '23' }, { b: '23' }],
    })
  })

  it('works on complex schema', () => {
    const schema = z.object({
      nested: z.object({
        union: oz.openapi(
          z.union([
            oz.openapi(z.string(), {
              $comment: 'comment for string',
            }),
            z.object({
              url: oz.openapi(oz.url(), {
                $comment: 'comment for url',
              }),
            }),
          ]),
          {
            $comment: 'comment for nested',
          },
        ),
      }),
    })

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: {
            union: {
              $comment: 'comment for nested',
              anyOf: [
                {
                  type: 'string',
                  $comment: 'comment for string',
                },
                {
                  type: 'object',
                  properties: {
                    url: {
                      type: 'string',
                      format: Format.URI,
                      $comment: 'comment for url',
                    },
                  },
                  required: ['url'],
                },
              ],
            },
          },
          required: ['union'],
        },
      },
      required: ['nested'],
    })
  })
})

describe('zod description', () => {
  it('should include descriptions for basic and nested properties', () => {
    const schema = z.object({
      name: z.string().describe('name description'),

      nested: z.object({
        name: z.string().describe('nested name description'),
      }),
    })

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'name description',
        },
        nested: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'nested name description',
            },
          },
          required: ['name'],
        },
      },
      required: ['name', 'nested'],
    })
  })

  it('should include outer and inner descriptions', () => {
    const schema = z.object({
      name: z.string().describe('name description'),

      nested: z.object({
        name: z.string().describe('nested name description'),
      }).describe('inner object description'),
    }).describe('outer object description')

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      description: 'outer object description',
      properties: {
        name: {
          type: 'string',
          description: 'name description',
        },
        nested: {
          type: 'object',
          description: 'inner object description',
          properties: {
            name: {
              type: 'string',
              description: 'nested name description',
            },
          },
          required: ['name'],
        },
      },
      required: ['name', 'nested'],
    })
  })
})
