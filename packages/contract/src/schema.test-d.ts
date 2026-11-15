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
const untypedSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'custom',
    validate: (value: unknown) => ({ value: value as string }),
  },
}
const undefinedTypesSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'custom',
    validate: (value: unknown) => ({ value: value as string }),
    types: undefined,
  },
}

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
  expectTypeOf<InferSchemaInput<typeof untypedSchema>>().toEqualTypeOf<unknown>()
  expectTypeOf<InferSchemaInput<typeof undefinedTypesSchema>>().toEqualTypeOf<never>()
})

it('InferSchemaInput with a generic schema', () => {
  function _generic<T extends Schema<{ id: string }>>(value: InferSchemaInput<T>) {
    expectTypeOf(value.id).toEqualTypeOf<string>()

    const _id: string = value.id
    const _value: { id: string } = value
  }

  function _unsound<T extends AnySchema>(value: unknown): InferSchemaInput<T> {
    // @ts-expect-error - unknown is not assignable to an unresolved schema type
    return value
  }
})

it('InferSchemaOutput', () => {
  expectTypeOf<InferSchemaOutput<typeof inputSchema>>().toEqualTypeOf<{ input: string }>()
  expectTypeOf<InferSchemaOutput<typeof outputSchema>>().toEqualTypeOf<{ output: number }>()
  expectTypeOf<InferSchemaOutput<typeof valibotSchema>>().toEqualTypeOf<{ value: number }>()
  expectTypeOf<InferSchemaOutput<typeof arktypeSchema>>().toEqualTypeOf<{ value: string }>()
  expectTypeOf<InferSchemaOutput<UnionSchema>>().toEqualTypeOf<{ a: string } | { b: string }>()
  expectTypeOf<InferSchemaOutput<AnySchema>>().toBeAny()
  expectTypeOf<InferSchemaOutput<any>>().toEqualTypeOf<unknown>()
  expectTypeOf<InferSchemaOutput<typeof untypedSchema>>().toEqualTypeOf<unknown>()
  expectTypeOf<InferSchemaOutput<typeof undefinedTypesSchema>>().toEqualTypeOf<never>()
})

it('InferSchemaOutput with a generic schema', () => {
  function _generic<T extends Schema<{ id: string }>>(value: InferSchemaOutput<T>) {
    expectTypeOf(value.id).toEqualTypeOf<string>()

    const _id: string = value.id
    const _value: { id: string } = value
  }

  function _unsound<T extends AnySchema>(value: unknown): InferSchemaOutput<T> {
    // @ts-expect-error - unknown is not assignable to an unresolved schema type
    return value
  }
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

  it('merges `any` and `AnySchema`', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>

    expectTypeOf<MergedSchema<any, Schema1>>().toEqualTypeOf<
      Schema<{ schema1: number }, { schema1: string }>
    >()
    expectTypeOf<MergedSchema<AnySchema, Schema1>>().toEqualTypeOf<Schema<any, any>>()
  })

  it('merges `never`', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>

    expectTypeOf<MergedSchema<never, Schema1>>().toEqualTypeOf<Schema<never, never>>()
    expectTypeOf<MergedSchema<Schema1, never>>().toEqualTypeOf<Schema<never, never>>()
  })

  it('merges the declared types of untyped schemas', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>

    expectTypeOf<MergedSchema<typeof untypedSchema, Schema1>>().toEqualTypeOf<
      Schema<{ schema1: number }, { schema1: string }>
    >()
    expectTypeOf<MergedSchema<typeof undefinedTypesSchema, Schema1>>().toEqualTypeOf<
      Schema<never, never>
    >()
  })

  it('merges union schemas', () => {
    type Schema1 = Schema<{ schema1: number }, { schema1: string }>
    type TMerged = MergedSchema<UnionSchema, Schema1>

    expectTypeOf<InferSchemaInput<TMerged>>().toEqualTypeOf<
      ({ a: number } | { b: number }) & { schema1: number }
    >()
    expectTypeOf<InferSchemaOutput<TMerged>>().toEqualTypeOf<
      ({ a: string } | { b: string }) & { schema1: string }
    >()
  })

  it('merges a generic schema', () => {
    function _generic<T extends Schema<{ id: string }, { id: number }>>(
      input: InferSchemaInput<MergedSchema<T, Schema<{ name: string }>>>,
      output: InferSchemaOutput<MergedSchema<T, Schema<{ name: string }>>>,
    ) {
      expectTypeOf(input.id).toEqualTypeOf<string>()
      expectTypeOf(input.name).toEqualTypeOf<string>()
      expectTypeOf(output.id).toEqualTypeOf<number>()
      expectTypeOf(output.name).toEqualTypeOf<string>()
    }

    function _unsound<T extends AnySchema>(
      value: unknown,
    ): InferSchemaInput<MergedSchema<T, Schema<{ name: string }>>> {
      // @ts-expect-error - unknown is not assignable to an unresolved schema type
      return value
    }
  })
})
