import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import type {
  ContractBuilderWithInput,
  ContractBuilderWithInputOutput,
  ContractBuilderWithOutput,
} from './builder-variants'
import type { MergedErrorMap } from './error-utils'
import type { Meta } from './meta'
import type { MergedSchema, Schema } from './schema'

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const schema1 = z.object({ schema1: z.number().transform((n) => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform((n) => `${n}`) })

describe('ContractBuilderWithInput', () => {
  const builder = {} as ContractBuilderWithInput<typeof schema1, typeof errorMap>

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' } })).toEqualTypeOf<
      ContractBuilderWithInput<
        typeof schema1,
        MergedErrorMap<typeof errorMap, { INVALID: { message: string } }>
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } })
  })

  it('.meta', () => {
    const plugin = { name: 'test', init: (m: Meta) => m }
    expectTypeOf(builder.meta(plugin)).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid meta
    builder.meta({} as MetaPlugin<Schema<'invalid'>, any, any>)
  })

  it('.input', () => {
    const extraSchema = z.object({ extra: z.string() })

    expectTypeOf(builder.input(extraSchema)).toEqualTypeOf<
      ContractBuilderWithInput<MergedSchema<typeof extraSchema, typeof schema1>, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.input('invalid')
  })

  it('.output', () => {
    expectTypeOf(builder.output(schema2)).toEqualTypeOf<
      ContractBuilderWithInputOutput<typeof schema1, typeof schema2, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.output('invalid')
  })
})

describe('ContractBuilderWithOutput', () => {
  const builder = {} as ContractBuilderWithOutput<typeof schema2, typeof errorMap>

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' } })).toEqualTypeOf<
      ContractBuilderWithOutput<
        typeof schema2,
        MergedErrorMap<typeof errorMap, { INVALID: { message: string } }>
      >
    >()

    // @ts-expect-error - invalid errors
    builder.errors({ INTERNAL_SERVER_ERROR: { data: {} } })
  })

  it('.meta', () => {
    const plugin = { name: 'test', init: (m: Meta) => m }
    expectTypeOf(builder.meta(plugin)).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid meta
    builder.meta({} as MetaPlugin<Schema<'invalid'>, any, any>)
  })

  it('.input', () => {
    expectTypeOf(builder.input(schema1)).toEqualTypeOf<
      ContractBuilderWithInputOutput<typeof schema1, typeof schema2, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.input('invalid')
  })

  it('.output', () => {
    const extraSchema = z.object({ extra: z.string() })

    expectTypeOf(builder.output(extraSchema)).toEqualTypeOf<
      ContractBuilderWithOutput<MergedSchema<typeof extraSchema, typeof schema2>, typeof errorMap>
    >()

    // @ts-expect-error - schema is invalid
    builder.output('invalid')
  })
})

describe('ContractBuilderWithInputOutput', () => {
  const builder = {} as ContractBuilderWithInputOutput<
    typeof schema1,
    typeof schema2,
    typeof errorMap
  >

  it('.errors', () => {
    expectTypeOf(builder.errors({ INVALID: { message: 'invalid' } })).toEqualTypeOf<
      ContractBuilderWithInputOutput<
        typeof schema1,
        typeof schema2,
        MergedErrorMap<typeof errorMap, { INVALID: { message: string } }>
      >
    >()

    // @ts-expect-error - invalid errors
    builder.errors({ INTERNAL_SERVER_ERROR: { data: {} } })
  })

  it('.meta', () => {
    const plugin = { name: 'test', init: (m: Meta) => m }
    expectTypeOf(builder.meta(plugin)).toEqualTypeOf<typeof builder>()

    // @ts-expect-error - invalid meta
    builder.meta({} as MetaPlugin<Schema<'invalid'>, any, any>)
  })

  it('.input', () => {
    const extraSchema = z.object({ extra: z.string() })

    expectTypeOf(builder.input(extraSchema)).toEqualTypeOf<
      ContractBuilderWithInputOutput<
        MergedSchema<typeof extraSchema, typeof schema1>,
        typeof schema2,
        typeof errorMap
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.input('invalid')
  })

  it('.output', () => {
    const extraSchema = z.object({ extra: z.string() })

    expectTypeOf(builder.output(extraSchema)).toEqualTypeOf<
      ContractBuilderWithInputOutput<
        typeof schema1,
        MergedSchema<typeof extraSchema, typeof schema2>,
        typeof errorMap
      >
    >()

    // @ts-expect-error - schema is invalid
    builder.output('invalid')
  })
})
