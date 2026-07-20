import * as v from 'valibot'
import * as z from 'zod'
import { $ZodRegistry, toJSONSchema } from 'zod/v4/core'
import { ZodToJsonSchemaConverter } from './converter'

vi.mock('zod/v4/core', async (original) => {
  const mod = await original<typeof import('zod/v4/core')>()
  return {
    ...mod,
    toJSONSchema: vi.fn((...args: [any]) => mod.toJSONSchema(...args)),
  }
})

describe('zodToJsonSchemaConverter', () => {
  const converter = new ZodToJsonSchemaConverter()
  const codecSchema = z.codec(z.string(), z.number(), {
    decode: value => Number(value),
    encode: value => String(value),
  })

  describe('.condition', () => {
    it.each([
      ['zod input schema', z.string(), 'input', true],
      ['zod output schema', z.string().optional(), 'output', true],
      ['non-zod schema', v.string() as never, 'input', false],
      ['undefined schema', undefined, 'output', false],
    ] as const)('matches %s', (_, schema, direction, expected) => {
      expect(converter.condition(schema, direction)).toBe(expected)
    })
  })

  it.each([
    ['input', { type: 'string' }],
    ['output', { type: 'number' }],
  ] as const)('uses the requested %s direction when generating json schema', (direction, jsonSchema) => {
    expect(converter.convert(codecSchema, direction)).toEqual([jsonSchema, false])
  })

  it('forwards extended toJSONSchema options from the constructor', () => {
    const converter = new ZodToJsonSchemaConverter({
      override: ({ jsonSchema, path }) => {
        jsonSchema.description = path.length === 0 ? 'root-schema' : path.join('.')
      },
    })

    expect(converter.convert(codecSchema, 'input')).toEqual([
      {
        description: 'root-schema',
        type: 'string',
      },
      false,
    ])

    expect(converter.convert(codecSchema, 'output')).toEqual([
      {
        description: 'root-schema',
        type: 'number',
      },
      false,
    ])
  })

  it('keeps converting when standard validation throws while checking optionality', () => {
    const schema = z.string()

    Object.defineProperty(schema, '~standard', {
      value: {
        ...schema['~standard'],
        validate: () => {
          throw new Error('validate failed')
        },
      },
    })
    expect(converter.convert(schema, 'input')).toEqual([{ type: 'string' }, false])
  })

  describe('supports $ref at root level', () => {
    it('with the global metadata registry and special json pointers', () => {
      const schema = z.object({
        a: z.string().meta({ id: 'a' }),
        b: z.number().meta({ id: 'b' }),
      }).meta({ id: 'root~/' })

      expect(converter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root~0~1',
        $defs: {
          'a': {
            type: 'string',
          },
          'b': {
            type: 'number',
          },
          'root~/': {
            type: 'object',
            properties: {
              a: {
                $ref: '#/$defs/a',
              },
              b: {
                $ref: '#/$defs/b',
              },
            },
            required: [
              'a',
              'b',
            ],
          },
        },
      }, false],
      )
    })

    it('with a custom metadata registry', () => {
      const registry = new $ZodRegistry()
      const customConverter = new ZodToJsonSchemaConverter({ metadata: registry as any })

      const schema = z.object({
        a: z.string(),
      })

      registry.add(schema, { id: 'root' })
      registry.add(schema.shape.a, { id: 'a' })

      expect(customConverter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root',
        $defs: {
          a: {
            type: 'string',
          },
          root: {
            type: 'object',
            properties: {
              a: {
                $ref: '#/$defs/a',
              },
            },
            required: [
              'a',
            ],
          },
        },
      }, false])
    })

    it('avoids overwriting existing $defs when the root id collides', () => {
      const schema = z.string().meta({ id: 'root' })

      vi.mocked(toJSONSchema).mockReturnValueOnce({
        $defs: {
          root: {
            type: 'number',
          },
        },
        type: 'string',
      } as any)

      expect(converter.convert(schema, 'input')).toEqual([{
        $ref: '#/$defs/root__0',
        $defs: {
          root: {
            type: 'number',
          },
          root__0: {
            type: 'string',
          },
        },
      }, false])
    })
  })

  describe('optionality', () => {
    it.each([
      ['defaulted input schema', z.string().default('fallback'), 'input', {
        default: 'fallback',
        type: 'string',
      }, true],
      ['defaulted output schema', z.string().default('fallback'), 'output', {
        default: 'fallback',
        type: 'string',
      }, false],
      ['undefined-producing output schema', z.string().optional(), 'output', {
        type: 'string',
      }, true],
      ['required input schema', z.string(), 'input', {
        type: 'string',
      }, false],
      ['required output schema', z.string(), 'output', {
        type: 'string',
      }, false],
    ] as const)('marks %s correctly', (_, schema, direction, jsonSchema, optional) => {
      expect(converter.convert(schema, direction)).toEqual([jsonSchema, optional])
    })
  })

  describe('native type extensions', () => {
    it.each([
      [z.bigint(), {
        'type': 'string',
        'x-native-type': 'bigint',
        'pattern': '^-?[0-9]+$',
      }],
      [z.date(), {
        'type': 'string',
        'x-native-type': 'date',
        'format': 'date-time',
      }],
      [z.set(z.string()), {
        'type': 'array',
        'x-native-type': 'set',
        'uniqueItems': true,
        'items': { type: 'string' },
      }],
      [z.map(z.string(), z.number()), {
        'type': 'array',
        'x-native-type': 'map',
        'items': {
          type: 'array',
          prefixItems: [
            { type: 'string' },
            { type: 'number' },
          ],
          maxItems: 2,
          minItems: 2,
        },
      }],
    ] as const)('extends conversion for %s', (schema, jsonSchema) => {
      expect(converter.convert(schema, 'input')).toEqual([jsonSchema, false])
    })
  })

  describe('respects an explicit `type` in metadata', () => {
    it('drops the leftover `anyOf` when a union pins a scalar type', () => {
      const schema = z.union([z.string(), z.number()]).meta({
        type: 'string',
        format: 'date-time',
        pattern: '^x$',
      })

      expect(converter.convert(schema, 'input')).toEqual([
        {
          type: 'string',
          format: 'date-time',
          pattern: '^x$',
        },
        false,
      ])
    })

    it('applies to unions nested inside an object', () => {
      const schema = z.object({
        createdAt: z.union([z.string(), z.number()]).meta({ type: 'string', format: 'date-time' }),
      })

      expect(converter.convert(schema, 'input')).toEqual([
        {
          type: 'object',
          properties: {
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['createdAt'],
        },
        false,
      ])
    })

    it('leaves object schemas untouched when metadata restates `type`', () => {
      const schema = z.object({ a: z.string() }).meta({ type: 'object', title: 'Foo' })

      expect(converter.convert(schema, 'input')).toEqual([
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          title: 'Foo',
        },
        false,
      ])
    })

    it('keeps the `anyOf` when a non-scalar `type` is pinned on a union', () => {
      // `object`/`array` branches carry real structure the metadata does not
      // restate, so the composition must survive rather than be discarded.
      const schema = z.union([
        z.object({ a: z.string() }),
        z.object({ b: z.number() }),
      ]).meta({ type: 'object' })

      expect(converter.convert(schema, 'input')).toEqual([
        {
          type: 'object',
          anyOf: [
            { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
          ],
        },
        false,
      ])
    })
  })
})
