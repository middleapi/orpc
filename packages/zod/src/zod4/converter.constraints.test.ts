import z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

/**
 * The constraints a schema's checks carry come from Zod's own `toJSONSchema`, so they hold
 * across the releases that moved where those checks are recorded internally.
 *
 * https://github.com/middleapi/orpc/issues/2018
 */
testSchemaConverter([
  {
    name: 'object carrying a bound on every property',
    schema: z.object({
      name: z.string().max(50),
      count: z.int().min(0).max(10),
      tags: z.array(z.string()).max(20),
    }),
    input: [true, {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 50 },
        count: { type: 'integer', minimum: 0, maximum: 10 },
        tags: { type: 'array', maxItems: 20, items: { type: 'string' } },
      },
      required: ['name', 'count', 'tags'],
    }],
  },
  {
    name: 'string.max(50).max(10) keeps the tighter bound',
    schema: z.string().max(50).max(10),
    input: [true, { type: 'string', maxLength: 10 }],
  },
  {
    name: 'number.min(5).min(3) keeps the tighter bound',
    schema: z.number().min(5).min(3),
    input: [true, { type: 'number', minimum: 5 }],
  },
  {
    name: 'int32 carries its format range',
    schema: z.int32(),
    input: [true, { type: 'integer', minimum: -2147483648, maximum: 2147483647 }],
  },
  {
    /**
     * An `id` makes Zod return the schema as a `$ref` into `$defs`, so its keywords have to be
     * read where Zod builds them rather than off what it returns.
     */
    name: 'string.max(10).meta({ id })',
    schema: z.string().max(10).meta({ id: 'Name', custom: 'kept out of the document' }),
    input: [true, { type: 'string', maxLength: 10 }],
  },
  {
    name: 'number.multipleOf(5).multipleOf(3)',
    schema: z.number().multipleOf(5).multipleOf(3),
    input: [true, { type: 'number', multipleOf: 5, allOf: [{ multipleOf: 3 }] }],
  },
])
