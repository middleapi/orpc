import z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

testSchemaConverter([
  {
    name: 'number',
    schema: z.number(),
    input: [true, { type: 'number' }],
  },
  {
    name: 'number.int()',
    schema: z.number().int(),
    input: [true, { type: 'integer', maximum: 9007199254740991, minimum: -9007199254740991 }],
  },
  {
    name: 'int.min(0).max(100)',
    schema: z.int().min(0).max(100),
    input: [true, { type: 'integer', maximum: 100, minimum: 0 }],
  },
  {
    name: 'number.min(0).max(100)',
    schema: z.number().min(0).max(100),
    input: [true, { type: 'number', minimum: 0, maximum: 100 }],
  },
  {
    name: 'number.min(0).max(23).int()',
    schema: z.number().min(0).max(23).int(),
    input: [true, { type: 'integer', minimum: 0, maximum: 23 }],
  },
  {
    name: 'number.multipleOf(5)',
    schema: z.number().multipleOf(5),
    input: [true, { type: 'number', multipleOf: 5 }],
  },
  {
    name: 'number.gt(6).lt(10)',
    schema: z.number().gt(6).lt(10),
    input: [true, { type: 'number', exclusiveMinimum: 6, exclusiveMaximum: 10 }],
  },
  {
    name: 'bigint',
    schema: z.bigint(),
    input: [true, { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' }],
  },
  {
    name: 'nan',
    schema: z.nan(),
    input: [true, { not: {} }],
    output: [true, { type: 'null' }],
  },
])
