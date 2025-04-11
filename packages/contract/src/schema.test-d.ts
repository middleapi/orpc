import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './schema'
import { type as arktypeType } from 'arktype'
import * as v from 'valibot'
import { z } from 'zod'
import { type } from './schema'

const zod = z.object({
  value: z.string().transform(() => 123),
})

const valibot = v.object({
  value: v.pipe(v.string(), v.transform(() => 123)),
})

// How convert value into number?
const arktype = arktypeType({
  value: 'string',
})

describe('Schema', () => {
  it('assignable', () => {
    const _zod: AnySchema = zod
    const _valibot: AnySchema = valibot
    const _arktype: AnySchema = arktype
  })
})

describe('SchemaInput', () => {
  it('inferable', () => {
    expectTypeOf<InferSchemaInput<typeof zod>>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<InferSchemaInput<typeof valibot>>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<InferSchemaInput<typeof arktype>>().toEqualTypeOf<{ value: string }>()
  })
})

describe('SchemaOutput', () => {
  it('inferable', () => {
    expectTypeOf<InferSchemaOutput<typeof zod>>().toEqualTypeOf<{ value: number }>()
    expectTypeOf<InferSchemaOutput<typeof valibot>>().toEqualTypeOf<{ value: number }>()
    expectTypeOf<InferSchemaOutput<typeof arktype>>().toEqualTypeOf<{ value: string }>()
  })
})

describe('type', () => {
  it('without map', () => {
    const schema = type<string>()

    expectTypeOf<InferSchemaInput<typeof schema>>().toEqualTypeOf<string>()
    expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<string>()
  })

  it('with map', () => {
    const schema2 = type<string, number>((val) => {
      expectTypeOf(val).toEqualTypeOf<string>()

      return Number(val)
    })

    expectTypeOf<InferSchemaInput<typeof schema2>>().toEqualTypeOf<string>()
    expectTypeOf<InferSchemaOutput<typeof schema2>>().toEqualTypeOf<number>()

    // @ts-expect-error - map is required when TInput !== TOutput
    type<string, number>()

    // @ts-expect-error - output not match number
    type<string, number>(() => '123')
  })
})
