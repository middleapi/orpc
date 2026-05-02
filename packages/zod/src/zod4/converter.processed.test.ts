import z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

testSchemaConverter([
  {
    name: 'lazy(() => z.object({ value: z.string() }))',
    schema: z.lazy(() => z.object({ value: z.string() })),
    input: [true, { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }],
  },
  {
    name: 'lazy(() => z.object({ value: z.lazy(() => z.string()) }))',
    schema: z.lazy(() => z.object({ value: z.lazy(() => z.string()) })),
    input: [true, { type: 'object', properties: { value: { } } }],
  },
  {
    name: 'string().transform(x => x)',
    schema: z.string().transform(x => x),
    input: [true, { type: 'string' }],
    output: [false, {}],
  },
  {
    name: 'preprocess(x => x, z.string())',
    schema: z.preprocess(x => x, z.string()),
    input: [true, { type: 'string' }],
    output: [true, { type: 'string' }],
  },
])
