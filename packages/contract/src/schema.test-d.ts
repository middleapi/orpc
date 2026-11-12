import { type as arktypeType } from 'arktype'
import * as v from 'valibot'
import * as z from 'zod'

import type { AnySchema, InferSchemaInput, InferSchemaOutput, MergedSchema, Schema } from './schema'

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })
const outputSchema = z.object({ output: z.string().transform((s) => Number(s)) })
const valibotSchema = v.object({
  value: v.pipe(
    v.string(),
    v.transform((s) => Number(s)),
  ),
})
const arktypeSchema = arktypeType({ value: 'string' })

type UnionSchema = Schema<{ a: number }, { a: string }> | Schema<{ b: number }, { b: string }>

describe('Schema', () => {
  it('supports any standard schema', () => {
    const _zod: AnySchema = z.object({
      value: z.string().transform(() => 123),
    })
    const _valibot: AnySchema = v.object({
      value: v.pipe(
        v.string(),
        v.transform(() => 123),
      ),
    })
    const _arktype: AnySchema = arktypeType({
      value: 'string',
    })
  })
})

it('InferSchemaInput', () => {
  expectTypeOf<InferSchemaInput<typeof inputSchema>>().toEqualTypeOf<{ input: number }>()
  expectTypeOf<InferSchemaInput<typeof outputSchema>>().toEqualTypeOf<{ output: string }>()
  expectTypeOf<InferSchemaInput<typeof valibotSchema>>().toEqualTypeOf<{ value: string }>()
  expectTypeOf<InferSchemaInput<typeof arktypeSchema>>().toEqualTypeOf<{ value: string }>()
  expectTypeOf<InferSchemaInput<UnionSchema>>().toEqualTypeOf<{ a: number } | { b: number }>()
  expectTypeOf<InferSchemaInput<AnySchema>>().toBeAny()
  expectTypeOf<InferSchemaInput<any>>().toEqualTypeOf<unknown>()
})

it('InferSchemaOutput', () => {
  expectTypeOf<InferSchemaOutput<typeof inputSchema>>().toEqualTypeOf<{ input: string }>()
  expectTypeOf<InferSchemaOutput<typeof outputSchema>>().toEqualTypeOf<{ output: number }>()
  expectTypeOf<InferSchemaOutput<typeof valibotSchema>>().toEqualTypeOf<{ value: number }>()
  expectTypeOf<InferSchemaOutput<typeof arktypeSchema>>().toEqualTypeOf<{ value: string }>()
  expectTypeOf<InferSchemaOutput<UnionSchema>>().toEqualTypeOf<{ a: string } | { b: string }>()
  expectTypeOf<InferSchemaOutput<AnySchema>>().toBeAny()
  expectTypeOf<InferSchemaOutput<any>>().toEqualTypeOf<unknown>()
})

describe('MergedSchema', () => {
  it('merges two schemas', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>
    type Schema2 = Schema<{ schema2: string }, { schema2: number }>

    type TMerged = MergedSchema<Schema1, Schema2>
    expectTypeOf<TMerged>().toEqualTypeOf<
      Schema<{ schema1: number } & { schema2: string }, { schema1: string } & { schema2: number }>
    >()
  })

  it('merges three schemas', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>
    type Schema2 = Schema<{ schema2: string }, { schema2: number }>
    type Schema3 = Schema<{ schema3: string }, { schema3: boolean }>

    type TMerged = MergedSchema<Schema1, MergedSchema<Schema2, Schema3>>
    expectTypeOf<TMerged>().toEqualTypeOf<
      Schema<
        { schema1: number } & { schema2: string } & { schema3: string },
        { schema1: string } & { schema2: number } & { schema3: boolean }
      >
    >()
  })

  it('works with zod, valibot, arktype', () => {
    const schema1 = z.object({
      schema1: z.number().transform((n) => `${n}`),
    })
    const schema2 = v.object({
      schema2: v.pipe(
        v.string(),
        v.transform((s) => Number(s)),
      ),
    })
    const schema3 = arktypeType({
      schema3: 'string',
    })

    type TMerged = MergedSchema<typeof schema1, MergedSchema<typeof schema2, typeof schema3>>
    expectTypeOf<TMerged>().toEqualTypeOf<
      Schema<
        { schema1: number } & { schema2: string } & { schema3: string },
        { schema1: string } & { schema2: number } & { schema3: string }
      >
    >()
  })

  it('works with InferSchemaInput and InferSchemaOutput', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>
    type Schema2 = Schema<{ schema2: string }, { schema2: number }>
    type Schema3 = Schema<{ schema3: string }, { schema3: boolean }>

    type TMerged = MergedSchema<Schema1, MergedSchema<Schema2, Schema3>>
    expectTypeOf<InferSchemaInput<TMerged>>().toEqualTypeOf<
      { schema1: number } & { schema2: string } & { schema3: string }
    >()
    expectTypeOf<InferSchemaOutput<TMerged>>().toEqualTypeOf<
      { schema1: string } & { schema2: number } & { schema3: boolean }
    >()
  })
})
