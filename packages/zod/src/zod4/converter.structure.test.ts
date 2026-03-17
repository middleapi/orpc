import z from 'zod/v4'
import * as zm from 'zod/v4-mini'
import { testSchemaConverter } from '../../tests/shared'

testSchemaConverter([
  {
    name: 'array(z.string())',
    schema: z.array(z.string()),
    input: [true, { type: 'array', items: { type: 'string' } }],
  },
  {
    name: 'array(z.string()).nonempty()',
    schema: z.array(z.string()).nonempty(),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 1 }],
  },
  {
    name: 'array(z.string()).min(10).max(20)',
    schema: z.array(z.string()).min(10).max(20),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 20 }],
  },
  {
    name: 'array(z.string()).length(10)',
    schema: z.array(z.string()).length(10),
    input: [true, { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 10 }],
  },
  {
    name: 'array(z.string().optional())',
    schema: z.array(z.string().optional()),
    input: [true, { type: 'array', items: { type: 'string' } }],
    output: [true, { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } }],
  },
  {
    name: 'array(z.string().optional())',
    schema: z.array(z.string().optional().default('a')),
    input: [true, { type: 'array', items: { type: 'string', default: 'a' } }],
  },
  {
    name: 'array(z.undefined())',
    schema: z.array(z.undefined()),
    input: [true, { type: 'array', items: { not: {} } }],
    output: [true, { type: 'array', items: { type: 'null' } }],
  },
  {
    name: 'tuple([z.enum(["a", "b"])])',
    schema: z.tuple([z.enum(['a', 'b'])]),
    input: [true, { type: 'array', prefixItems: [{ enum: ['a', 'b'] }] }],
  },
  {
    name: 'tuple([z.enum(["a", "b"])], z.string())',
    schema: z.tuple([z.enum(['a', 'b'])], z.string()),
    input: [true, { type: 'array', prefixItems: [{ enum: ['a', 'b'] }], items: { type: 'string' } }],
  },
  {
    name: 'zm.tuple([zm.enum(["a", "b"])], zm.string()).check(zm.minLength(4), zm.maxLength(10))',
    schema: zm.tuple([zm.enum(['a', 'b'])], zm.string()).check(zm.minLength(4), zm.maxLength(10)),
    input: [true, { type: 'array', prefixItems: [{ enum: ['a', 'b'] }], items: { type: 'string' }, minItems: 4, maxItems: 10 }],
  },
  {
    name: 'set(z.string())',
    schema: z.set(z.string()),
    input: [true, { 'type': 'array', 'uniqueItems': true, 'items': { type: 'string' }, 'x-native-type': 'set' }],
  },
  {
    name: 'set(z.string().optional())',
    schema: z.set(z.string().optional()),
    input: [true, { 'type': 'array', 'uniqueItems': true, 'items': { type: 'string' }, 'x-native-type': 'set' }],
    output: [true, { 'type': 'array', 'uniqueItems': true, 'items': { anyOf: [{ type: 'string' }, { type: 'null' }] }, 'x-native-type': 'set' }],
  },
  {
    name: 'object({ value: z.string() })',
    schema: z.object({ value: z.string() }),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }],
  },
  {
    name: 'object({ value: z.string().optional() })',
    schema: z.object({ value: z.string().optional() }),
    input: [true, { type: 'object', properties: { value: { type: 'string' } } }],
  },
  {
    name: 'object({ value: z.undefined() })',
    schema: z.object({ value: z.undefined() }),
    input: [true, { type: 'object', properties: { value: { not: {} } } }],
  },
  {
    name: 'object({ value: z.string() }).strict()',
    schema: z.object({ value: z.string() }).strict(),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }],
  },
  {
    name: 'object({ value: z.string() }).catchall(z.number())',
    schema: z.object({ value: z.string() }).catchall(z.number()),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: { type: 'number' } }],
  },
  {
    name: 'record(z.number(), z.string())',
    schema: z.record(z.number(), z.string()),
    input: [true, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { type: 'number' } }],
  },
  {
    name: 'record(z.iso.date(), z.string())',
    schema: z.record(z.iso.date(), z.string()),
    input: [true, { type: 'object', additionalProperties: { type: 'string' }, propertyNames: { type: 'string', format: 'date' } }],
  },
  {
    name: 'record(z.string(), z.number().optional())',
    schema: z.record(z.string(), z.number().optional()),
    input: [true, { type: 'object', additionalProperties: { type: 'number' }, propertyNames: { type: 'string' } }],
  },
  {
    name: 'map(z.string(), z.number())',
    schema: z.map(z.string(), z.number()),
    input: [true, { 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], maxItems: 2, minItems: 2 }, 'x-native-type': 'map' }],
  },
  {
    name: 'map(z.string().optional(), z.number().optional())',
    schema: z.map(z.string().optional(), z.number().optional()),
    input: [true, { 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], maxItems: 2, minItems: 2 }, 'x-native-type': 'map' }],
    output: [true, { 'type': 'array', 'items': { type: 'array', prefixItems: [{ anyOf: [{ type: 'string' }, { type: 'null' }] }, { anyOf: [{ type: 'number' }, { type: 'null' }] }], maxItems: 2, minItems: 2 }, 'x-native-type': 'map' }],
  },
])
