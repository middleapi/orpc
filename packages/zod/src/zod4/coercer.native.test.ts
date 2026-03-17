import z from 'zod/v4'
import { testSchemaSmartCoercion } from '../../tests/shared'

enum TestEnum {
  NUMBER = 123,
  STRING = 'string',
}

testSchemaSmartCoercion([
  {
    name: 'number - 12345',
    schema: z.number(),
    input: '12345',
    expected: 12345,
  },
  {
    name: 'number - -12345',
    schema: z.number(),
    input: '-12345',
    expected: -12345,
  },
  {
    name: 'number - 12345n',
    schema: z.number(),
    input: '12345n',
  },
  {
    name: 'bigint - 12345',
    schema: z.bigint(),
    input: '12345',
    expected: 12345n,
  },
  {
    name: 'bigint - -12345',
    schema: z.bigint(),
    input: '-12345',
    expected: -12345n,
  },
  {
    name: 'bigint - 12345n',
    schema: z.bigint(),
    input: '12345n',
  },
  {
    name: 'bigint - true',
    schema: z.bigint(),
    input: true,
  },
  {
    name: 'boolean - t',
    schema: z.boolean(),
    input: 't',
    expected: true,
  },
  {
    name: 'boolean - true',
    schema: z.boolean(),
    input: 'true',
    expected: true,
  },
  {
    name: 'boolean - on',
    schema: z.boolean(),
    input: 'on',
    expected: true,
  },
  {
    name: 'boolean - ON',
    schema: z.boolean(),
    input: 'ON',
    expected: true,
  },
  {
    name: 'boolean - f',
    schema: z.boolean(),
    input: 'f',
    expected: false,
  },
  {
    name: 'boolean - false',
    schema: z.boolean(),
    input: 'false',
    expected: false,
  },
  {
    name: 'boolean - off',
    schema: z.boolean(),
    input: 'off',
    expected: false,
  },
  {
    name: 'boolean - OFF',
    schema: z.boolean(),
    input: 'OFF',
    expected: false,
  },
  {
    name: 'boolean - hi',
    schema: z.boolean(),
    input: 'hi',
    expected: 'hi',
  },
  {
    name: 'date - iso string',
    schema: z.date(),
    input: new Date('2023-01-01').toISOString(),
    expected: new Date('2023-01-01'),
  },
  {
    name: 'date - 2023-01-01',
    schema: z.date(),
    input: '2023-01-01',
    expected: new Date('2023-01-01'),
  },
  {
    name: 'date - 2023-01-01I',
    schema: z.date(),
    input: '2023-01-01I',
    expected: '2023-01-01I',
  },
  {
    name: 'date - array',
    schema: z.date(),
    input: [],
    expected: [],
  },
  {
    name: 'literal - 199',
    schema: z.literal([199, '199', 200n, undefined]),
    input: '199',
  },
  {
    name: 'literal - 200',
    schema: z.literal([199, '199', 200n, undefined, true]),
    input: '200',
    expected: 200n,
  },
  {
    name: 'literal - undefined',
    schema: z.literal([199, '199', 200n, undefined, true]),
    input: undefined,
  },
  {
    name: 'literal - undefined',
    schema: z.literal([199, '199', 200n, undefined, true]),
    input: 'true',
    expected: true,
  },
  {
    name: 'nativeEnum - 123',
    schema: z.enum(TestEnum),
    input: '123',
    expected: 123,
  },
  {
    name: 'nativeEnum - string',
    schema: z.enum(TestEnum),
    input: 'string',
  },
  {
    name: 'nativeEnum - 123n',
    schema: z.enum(TestEnum),
    input: '123n',
  },
  {
    name: 'enum - 123',
    schema: z.enum(['123', '456']),
    input: '123',
  },
])
