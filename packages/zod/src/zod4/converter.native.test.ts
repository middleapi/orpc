import * as z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

enum ExampleEnum {
  A = 'a',
  B = 'b',
}

testSchemaConverter([
  {
    name: 'boolean',
    schema: z.boolean(),
    input: [true, { type: 'boolean' }],
  },
  {
    name: 'success(z.boolean())',
    schema: z.success(z.boolean()),
    input: [true, { type: 'boolean' }],
  },
  {
    name: 'date',
    schema: z.date(),
    input: [true, { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }],
  },
  {
    name: 'null',
    schema: z.null(),
    input: [true, { type: 'null' }],
  },
  {
    name: 'any',
    schema: z.any(),
    input: [false, { }],
  },
  {
    name: 'unknown',
    schema: z.unknown(),
    input: [false, {}],
  },
  {
    name: 'undefined',
    schema: z.undefined(),
    input: [false, { not: {} }],
  },
  {
    name: 'string.optional()',
    schema: z.string().optional(),
    input: [false, { type: 'string' }],
  },
  {
    name: 'string.optional()',
    schema: z.string().optional().nonoptional(),
    input: [true, { type: 'string' }],
  },
  {
    name: 'string.nullable()',
    schema: z.string().nullable(),
    input: [true, { anyOf: [{ type: 'string' }, { type: 'null' }] }],
  },
  {
    name: 'void',
    schema: z.void(),
    input: [false, { not: {} }],
  },
  {
    name: 'never',
    schema: z.never(),
    input: [true, { not: {} }],
  },
  {
    name: 'literal(undefined)',
    schema: z.literal(undefined),
    input: [false, { not: {} }],
  },
  {
    name: 'literal(1234)',
    schema: z.literal(1234),
    input: [true, { const: 1234 }],
  },
  {
    name: 'literal([1234, 1234n, "abc"])',
    schema: z.literal([1234, 1234n, 'abc']),
    input: [true, { enum: [1234, '1234', 'abc'] }],
  },
  {
    name: 'literal([undefined, 1234, 1234n, "abc"])',
    schema: z.literal([undefined, 1234, 1234n, 'abc']),
    input: [false, { enum: [1234, '1234', 'abc'] }],
  },
  {
    name: 'enum(["a", "b"])',
    schema: z.enum(['a', 'b']),
    input: [true, { enum: ['a', 'b'] }],
  },
  {
    name: 'enum(ExampleEnum)',
    schema: z.enum(ExampleEnum),
    input: [true, { enum: ['a', 'b'] }],
  },
  {
    name: 'file()',
    schema: z.file(),
    input: [true, { type: 'string', contentMediaType: '*/*' }],
  },
  {
    name: 'file().mime(["image/png"])',
    schema: z.file().mime(['image/png']),
    input: [true, { type: 'string', contentMediaType: 'image/png' }],
  },
  {
    name: 'file().mime(["image/png", "image/jpeg"])',
    schema: z.file().mime(['image/png', 'image/jpeg']),
    input: [true, {
      anyOf: [
        { type: 'string', contentMediaType: 'image/png' },
        { type: 'string', contentMediaType: 'image/jpeg' },
      ],
    }],
  },
])
