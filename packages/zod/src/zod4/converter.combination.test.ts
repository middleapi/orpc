import z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

testSchemaConverter([
  {
    name: 'union([z.string(), z.number()])',
    schema: z.union([z.string(), z.number()]),
    input: [true, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    name: 'union([z.string(), z.number().optional()])',
    schema: z.union([z.string(), z.number().optional()]),
    input: [false, { anyOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    name: 'union([z.string(), z.undefined()])',
    schema: z.union([z.string(), z.undefined()]),
    input: [false, { anyOf: [{ type: 'string' }] }],
  },
  {
    name: 'intersection(z.string(), z.number())',
    schema: z.intersection(z.string(), z.number()),
    input: [true, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    name: 'intersection(z.string().optional(), z.number().optional())',
    schema: z.intersection(z.string().optional(), z.number().optional()),
    input: [false, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
  {
    name: 'intersection(z.string().optional(), z.number().optional())',
    schema: z.intersection(z.string().optional(), z.number().optional()),
    input: [false, { allOf: [{ type: 'string' }, { type: 'number' }] }],
  },
])
