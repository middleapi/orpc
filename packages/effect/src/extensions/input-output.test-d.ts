import type { ContractBuilder, MergedSchema, ProcedureContractBuilderWithInput, ProcedureContractBuilderWithInputOutput, ProcedureContractBuilderWithOutput } from '@orpc/contract'
import type { Builder, BuilderWithInput, BuilderWithInputOutput, BuilderWithMiddlewares, BuilderWithOutput, Schema } from '@orpc/server'
import { Schema as EffectSchema } from 'effect'
import { z } from 'zod'
import './input-output'

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

const schema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform(n => `${n}`) })

const NumberFromString = EffectSchema.NumberFromString

it('adds .input<EffectSchema> .output<EffectSchema> into ContractBuilder', async () => {
  const builder = {} as ContractBuilder<typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInput<
      Schema<string, number>,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithOutput<
      Schema<number, string>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into ProcedureContractBuilderWithInput', async () => {
  const builder = {} as ProcedureContractBuilderWithInput<typeof schema1, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInput<
      MergedSchema<Schema<string, number>, typeof schema1>,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInputOutput<
      typeof schema1,
      Schema<number, string>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into ProcedureContractBuilderWithOutput', async () => {
  const builder = {} as ProcedureContractBuilderWithOutput<typeof schema2, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInputOutput<
      Schema<string, number>,
      typeof schema2,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithOutput<
      MergedSchema<Schema<number, string>, typeof schema2>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into ProcedureContractBuilderWithInputOutput', async () => {
  const builder = {} as ProcedureContractBuilderWithInputOutput<typeof schema1, typeof schema2, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInputOutput<
      MergedSchema<Schema<string, number>, typeof schema1>,
      typeof schema2,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    ProcedureContractBuilderWithInputOutput<
      typeof schema1,
      MergedSchema<Schema<number, string>, typeof schema2>,
      typeof errorMap
    >
  >()
})

it('adds .input<EffectSchema> .output<EffectSchema> into Builder', async () => {
  const builder = {} as Builder<{ auth: boolean }, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    BuilderWithInput<
      { auth: boolean },
      object,
      Schema<string, number>,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    BuilderWithOutput<
      { auth: boolean },
      object,
      Schema<number, string>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into BuilderWithMiddlewares', async () => {
  const builder = {} as BuilderWithMiddlewares<{ auth: boolean }, { extra: boolean }, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    BuilderWithInput<
      { auth: boolean },
      { extra: boolean },
      Schema<string, number>,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    BuilderWithOutput<
      { auth: boolean },
      { extra: boolean },
      Schema<number, string>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into BuilderWithInput', async () => {
  const builder = {} as BuilderWithInput<{ auth: boolean }, { extra: boolean }, typeof schema1, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    BuilderWithInput<
      { auth: boolean },
      { extra: boolean },
      MergedSchema<Schema<string, number>, typeof schema1>,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    BuilderWithInputOutput<
      { auth: boolean },
      { extra: boolean },
      typeof schema1,
      Schema<number, string>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into BuilderWithOutput', async () => {
  const builder = {} as BuilderWithOutput<{ auth: boolean }, { extra: boolean }, typeof schema2, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    BuilderWithInputOutput<
      { auth: boolean },
      { extra: boolean },
      Schema<string, number>,
      typeof schema2,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    BuilderWithOutput<
      { auth: boolean },
      { extra: boolean },
      MergedSchema<Schema<number, string>, typeof schema2>,
      typeof errorMap
    >
  >()
})

describe('adds .input<EffectSchema> .output<EffectSchema> into BuilderWithInputOutput', async () => {
  const builder = {} as BuilderWithInputOutput<{ auth: boolean }, { extra: boolean }, typeof schema1, typeof schema2, typeof errorMap>

  expectTypeOf(builder.input(NumberFromString)).toEqualTypeOf<
    BuilderWithInputOutput<
      { auth: boolean },
      { extra: boolean },
      MergedSchema<Schema<string, number>, typeof schema1>,
      typeof schema2,
      typeof errorMap
    >
  >()

  expectTypeOf(builder.output(NumberFromString)).toEqualTypeOf<
    BuilderWithInputOutput<
      { auth: boolean },
      { extra: boolean },
      typeof schema1,
      MergedSchema<Schema<number, string>, typeof schema2>,
      typeof errorMap
    >
  >()
})

describe('.output<EffectSchema> encodes Type into Encoded', () => {
  const builder = {} as Builder<{ auth: boolean }, typeof errorMap>

  it('handler returns Type', () => {
    builder.output(NumberFromString).handler(() => 5)
    // @ts-expect-error handler must return Type, not Encoded
    builder.output(NumberFromString).handler(() => '5')
  })

  it('requires output schemas to encode without services', () => {
    builder.output({} as EffectSchema.Codec<number, string, 'decoding-service', never>)
    // @ts-expect-error encoding requires a service
    builder.output({} as EffectSchema.Codec<number, string, never, 'encoding-service'>)
  })

  it('keeps effect schemas already converted to standard schemas', () => {
    const converted = EffectSchema.toStandardSchemaV1(NumberFromString)

    expectTypeOf(({} as ContractBuilder<typeof errorMap>).output(converted)).toEqualTypeOf<ProcedureContractBuilderWithOutput<typeof converted, typeof errorMap>>()
    expectTypeOf(builder.output(converted)).toEqualTypeOf<BuilderWithOutput<{ auth: boolean }, object, typeof converted, typeof errorMap>>()
  })
})
