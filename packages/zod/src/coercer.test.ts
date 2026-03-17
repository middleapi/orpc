import type { ZodTypeAny } from 'zod/v3'
import { z } from 'zod/v3'
import { ZodSmartCoercionPlugin } from './coercer'
import { regexp } from './schemas/regexp'
import { url } from './schemas/url'

type TestCase = {
  schema: ZodTypeAny
  input: unknown
  expected: unknown
}

enum TestEnum {
  NUMBER = 123,
  STRING = 'string',
}

const nativeCases: TestCase[] = [
  {
    schema: z.number(),
    input: '12345',
    expected: 12345,
  },
  {
    schema: z.number(),
    input: '-12345',
    expected: -12345,
  },
  {
    schema: z.number(),
    input: '12345n',
    expected: '12345n',
  },
  {
    schema: z.bigint(),
    input: '12345',
    expected: 12345n,
  },
  {
    schema: z.bigint(),
    input: '-12345',
    expected: -12345n,
  },
  {
    schema: z.bigint(),
    input: '12345n',
    expected: '12345n',
  },
  {
    schema: z.boolean(),
    input: 't',
    expected: true,
  },
  {
    schema: z.boolean(),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean(),
    input: 'on',
    expected: true,
  },
  {
    schema: z.boolean(),
    input: 'ON',
    expected: true,
  },
  {
    schema: z.boolean(),
    input: 'f',
    expected: false,
  },
  {
    schema: z.boolean(),
    input: 'false',
    expected: false,
  },
  {
    schema: z.boolean(),
    input: 'off',
    expected: false,
  },
  {
    schema: z.boolean(),
    input: 'OFF',
    expected: false,
  },
  {
    schema: z.boolean(),
    input: 'hi',
    expected: 'hi',
  },
  {
    schema: z.date(),
    input: new Date('2023-01-01').toISOString(),
    expected: new Date('2023-01-01'),
  },
  {
    schema: z.date(),
    input: '2023-01-01',
    expected: new Date('2023-01-01'),
  },
  {
    schema: z.date(),
    input: '2023-01-01I',
    expected: '2023-01-01I',
  },
  {
    schema: z.literal(199n),
    input: '199',
    expected: BigInt(199),
  },
  {
    schema: z.literal(199),
    input: '199',
    expected: 199,
  },
  {
    schema: z.literal(true),
    input: 't',
    expected: true,
  },
  {
    schema: z.literal(null),
    input: 'null',
    expected: 'null',
  },
  {
    schema: z.nativeEnum(TestEnum),
    input: '123',
    expected: 123,
  },
  {
    schema: z.nativeEnum(TestEnum),
    input: 'string',
    expected: 'string',
  },
  {
    schema: z.nativeEnum(TestEnum),
    input: '123n',
    expected: '123n',
  },
]

const combinationCases: TestCase[] = [
  {
    schema: z.union([z.boolean(), z.number()]),
    input: '123',
    expected: 123,
  },
  {
    schema: z.union([z.boolean(), z.number()]),
    input: 'true',
    expected: true,
  },
  {
    schema: z.union([z.boolean(), z.number()]),
    input: 'INVALID',
    expected: 'INVALID',
  },
  {
    schema: z.union([] as any),
    input: 'INVALID',
    expected: 'INVALID',
  },
  {
    schema: z.object({ a: z.number() }).and(z.object({ b: z.boolean() })),
    input: { a: '1234', b: 'true' },
    expected: { a: 1234, b: true },
  },
  {
    schema: z.boolean().readonly(),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().pipe(z.string()),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().transform(() => {}),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().brand<'CAT'>(),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().catch(false),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().default(false),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().nullable(),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().nullable(),
    input: null,
    expected: null,
  },
  {
    schema: z.boolean().optional(),
    input: 'true',
    expected: true,
  },
  {
    schema: z.boolean().optional(),
    input: undefined,
    expected: undefined,
  },
  {
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.object({ value: z.boolean() })) })),
    input: { value: { value: 'true' } },
    expected: { value: { value: true } },
  },
  {
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.object({ value: z.boolean() })) })),
    input: { value: { } },
    expected: { value: { } },
  },
  {
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.object({ value: z.boolean() })) })),
    input: undefined,
    expected: undefined,
  },
]

const customSchemaCases: TestCase[] = [
  {
    schema: url(),
    input: 'https://www.google.com',
    expected: new URL('https://www.google.com'),
  },
  {
    schema: url(),
    input: 'INVALID',
    expected: 'INVALID',
  },
  {
    schema: regexp(),
    input: '/abcd/i',
    expected: /abcd/i,
  },
  {
    schema: regexp(),
    input: '/invalid',
    expected: '/invalid',
  },
]

const notCoerceCases: TestCase[] = [
  {
    schema: z.number().or(z.string()),
    input: '123',
    expected: '123',
  },
  {
    schema: z.boolean().or(z.string()),
    input: 'true',
    expected: 'true',
  },
]

describe.each([
  ...nativeCases,
  ...combinationCases,
  ...customSchemaCases,
  ...notCoerceCases,
])('zodSmartCoercionPlugin: %#', ({ schema, input, expected }) => {
  const plugin = new ZodSmartCoercionPlugin()
  const options = {} as any
  plugin.init(options)

  const coerce = (schema: ZodTypeAny, input: unknown) => {
    let coerced: unknown

    options.clientInterceptors[0]({
      procedure: {
        '~orpc': {
          inputSchema: schema,
        },
      },
      input,
      next: ({ input }: any) => {
        coerced = input
      },
    })

    return coerced
  }

  it('flat', () => {
    expect(coerce(schema, input)).toEqual(expected)
    expect(coerce(schema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('object', () => {
    const testSchema = z.object({ a: schema, b: schema })
    expect(coerce(testSchema, { a: input, b: input, c: input })).toEqual({ a: expected, b: expected, c: input })
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('object missing', () => {
    const testSchema = z.object({ a: schema, b: schema })
    expect(coerce(testSchema, { a: input })).toEqual({ a: expected })
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('object with catchall', () => {
    const testSchema = z.object({ a: schema, b: schema }).catchall(schema)
    expect(coerce(testSchema, { a: input, b: input, c: input })).toEqual({ a: expected, b: expected, c: expected })
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('record', () => {
    const testSchema = z.record(schema)
    expect(coerce(testSchema, { a: input, b: input, c: input })).toEqual({ a: expected, b: expected, c: expected })
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('array', () => {
    const testSchema = z.array(schema)
    expect(coerce(testSchema, [input, input])).toEqual([expected, expected])
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('tuple', () => {
    const testSchema = z.tuple([schema, schema])
    expect(coerce(testSchema, [input, input, input])).toEqual([expected, expected, input])
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('tuple with rest', () => {
    const testSchema = z.tuple([schema, schema]).rest(schema)
    expect(coerce(testSchema, [input, input, input])).toEqual([expected, expected, expected])
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('set', () => {
    const testSchema = z.set(schema)
    expect(coerce(testSchema, [input])).toEqual(new Set([expected]))
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })

  it('map', () => {
    const testSchema = z.map(schema, schema)
    expect(coerce(testSchema, [[input, '__VALUE__'], ['__KEY__', input]])).toEqual(new Map([[expected, '__VALUE__'], ['__KEY__', expected]]))
    expect(coerce(testSchema, '__INVALID__')).toEqual('__INVALID__')
  })
})

it('zodSmartCoercionPlugin ignore non-zod schemas', async () => {
  const plugin = new ZodSmartCoercionPlugin()
  const options = {} as any
  plugin.init(options)

  const coerce = (schema: any, input: unknown) => {
    let coerced: unknown

    options.clientInterceptors[0]({
      procedure: {
        '~orpc': {
          inputSchema: schema,
        },
      },
      input,
      next: (options: any) => {
        coerced = typeof options === 'object' ? options.input : input
      },
    })

    return coerced
  }

  const val = { value: 123 }

  expect(coerce(z.object({}), val)).toEqual(val)
  expect(coerce(z.object({}), val)).not.toBe(val)

  const z4 = await import('zod/v4')
  expect(coerce(z4.object({}), val)).toBe(val)

  const v = await import('valibot')
  expect(coerce(v.object({}), val)).toBe(val)
})
