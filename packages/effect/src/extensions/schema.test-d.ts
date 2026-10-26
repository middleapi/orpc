import type { ContractBuilder, MergedErrorMap, MergedSchema, ProcedureContractBuilderWithInput, ProcedureContractBuilderWithInputOutput, ProcedureContractBuilderWithOutput } from '@orpc/contract'
import type { Builder, BuilderWithInput, BuilderWithInputOutput, BuilderWithMiddlewares, BuilderWithOutput, DecoratedProcedure, Schema } from '@orpc/server'
import { error } from '@orpc/contract'
import { Schema as EffectSchema } from 'effect'
import { z } from 'zod'
import './schema'

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

const schema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform(n => `${n}`) })

const NumberFromString = EffectSchema.NumberFromString

const FactoryError = error('FACTORY')

const effectErrorMap = {
  STANDARD: { message: 'standard', data: schema1 },
  EFFECT: { message: 'effect', data: NumberFromString },
  NO_DATA: { message: 'no data' },
  FACTORY: FactoryError,
}

type ExpectedEffectErrorMap = {
  STANDARD: { message: string, data: typeof schema1 }
  EFFECT: { message: string, data: Schema<string, number> }
  NO_DATA: { message: string }
  FACTORY: typeof FactoryError
}

it('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into ContractBuilder', async () => {
  const builder = {} as ContractBuilder<typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    ContractBuilder<
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into ProcedureContractBuilderWithInput', async () => {
  const builder = {} as ProcedureContractBuilderWithInput<typeof schema1, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    ProcedureContractBuilderWithInput<
      typeof schema1,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into ProcedureContractBuilderWithOutput', async () => {
  const builder = {} as ProcedureContractBuilderWithOutput<typeof schema2, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    ProcedureContractBuilderWithOutput<
      typeof schema2,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into ProcedureContractBuilderWithInputOutput', async () => {
  const builder = {} as ProcedureContractBuilderWithInputOutput<typeof schema1, typeof schema2, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    ProcedureContractBuilderWithInputOutput<
      typeof schema1,
      typeof schema2,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

it('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into Builder', async () => {
  const builder = {} as Builder<{ auth: boolean }, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    Builder<
      { auth: boolean },
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into BuilderWithMiddlewares', async () => {
  const builder = {} as BuilderWithMiddlewares<{ auth: boolean }, { extra: boolean }, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    BuilderWithMiddlewares<
      { auth: boolean },
      { extra: boolean },
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into BuilderWithInput', async () => {
  const builder = {} as BuilderWithInput<{ auth: boolean }, { extra: boolean }, typeof schema1, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    BuilderWithInput<
      { auth: boolean },
      { extra: boolean },
      typeof schema1,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into BuilderWithOutput', async () => {
  const builder = {} as BuilderWithOutput<{ auth: boolean }, { extra: boolean }, typeof schema2, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    BuilderWithOutput<
      { auth: boolean },
      { extra: boolean },
      typeof schema2,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

describe('adds .input<EffectSchema> .output<EffectSchema> .errors<EffectSchema> into BuilderWithInputOutput', async () => {
  const builder = {} as BuilderWithInputOutput<{ auth: boolean }, { extra: boolean }, typeof schema1, typeof schema2, typeof errorMap>

  expectTypeOf(builder.errors(effectErrorMap)).toEqualTypeOf<
    BuilderWithInputOutput<
      { auth: boolean },
      { extra: boolean },
      typeof schema1,
      typeof schema2,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()

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

it('adds .errors<EffectSchema> into DecoratedProcedure', async () => {
  const procedure = {} as DecoratedProcedure<{ auth: boolean }, { extra: boolean }, typeof schema1, typeof schema2, typeof errorMap>

  expectTypeOf(procedure.errors(effectErrorMap)).toEqualTypeOf<
    DecoratedProcedure<
      { auth: boolean },
      { extra: boolean },
      typeof schema1,
      typeof schema2,
      MergedErrorMap<typeof errorMap, ExpectedEffectErrorMap>
    >
  >()
})

describe('.errors<EffectSchema>', () => {
  const builder = {} as Builder<{ auth: boolean }, typeof errorMap>

  it('keeps error maps without effect schema as is', () => {
    const standardErrorMap = { STANDARD: { message: 'standard', data: schema1 } }

    expectTypeOf(builder.errors(standardErrorMap)).toEqualTypeOf<
      Builder<
        { auth: boolean },
        MergedErrorMap<typeof errorMap, typeof standardErrorMap>
      >
    >()
  })

  it('types error constructors with effect schema encoded type', () => {
    builder.errors(effectErrorMap).handler(({ errors }) => {
      errors.EFFECT({ data: '123' })
      // @ts-expect-error - data must match the encoded type
      errors.EFFECT({ data: 123 })
    })
  })

  it('rejects invalid error data schema', () => {
    // @ts-expect-error - data must be a standard schema or an effect schema
    builder.errors({ INVALID: { data: 123 } })
  })
})
