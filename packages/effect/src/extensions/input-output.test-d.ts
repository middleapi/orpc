import type { ContractBuilder, MergedSchema, ProcedureContractBuilderWithInput, ProcedureContractBuilderWithInputOutput, ProcedureContractBuilderWithOutput } from '@orpc/contract'
import type { Builder, BuilderWithInput, BuilderWithInputOutput, BuilderWithMiddlewares, BuilderWithOutput, RouterClient, Schema } from '@orpc/server'
import { os } from '@orpc/server'
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
      Schema<string, number>,
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
      Schema<string, number>,
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
      MergedSchema<Schema<string, number>, typeof schema2>,
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
      MergedSchema<Schema<string, number>, typeof schema2>,
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
      Schema<string, number>,
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
      Schema<string, number>,
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
      Schema<string, number>,
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
      MergedSchema<Schema<string, number>, typeof schema2>,
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
      MergedSchema<Schema<string, number>, typeof schema2>,
      typeof errorMap
    >
  >()
})

describe('output direction', () => {
  const Output = EffectSchema.Struct({ n: EffectSchema.NumberFromString })

  it('handler returns the encoded type and the client receives the decoded type', () => {
    const procedure = os.output(Output).handler(() => ({ n: '42' }))
    // @ts-expect-error the decoded type is not a valid handler output
    os.output(Output).handler(() => ({ n: 42 }))

    const client = {} as RouterClient<{ procedure: typeof procedure }>
    expectTypeOf<Awaited<ReturnType<typeof client.procedure>>>().toEqualTypeOf<{ readonly n: number }>()
  })

  it('handler returns the decoded type and the client receives the encoded type with Schema.flip', () => {
    const procedure = os.output(EffectSchema.flip(Output)).handler(() => ({ n: 42 }))
    // @ts-expect-error the encoded type is not a valid handler output
    os.output(EffectSchema.flip(Output)).handler(() => ({ n: '42' }))

    const client = {} as RouterClient<{ procedure: typeof procedure }>
    expectTypeOf<Awaited<ReturnType<typeof client.procedure>>>().toEqualTypeOf<{ readonly n: string }>()
  })
})
