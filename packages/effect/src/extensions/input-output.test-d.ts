import type { ContractBuilder, MergedSchema, ProcedureContractBuilderWithInput, ProcedureContractBuilderWithInputOutput, ProcedureContractBuilderWithOutput, RouterContractClient } from '@orpc/contract'
import type { Builder, BuilderWithInput, BuilderWithInputOutput, BuilderWithMiddlewares, BuilderWithOutput, RouterClient, Schema } from '@orpc/server'
import { oc } from '@orpc/contract'
import { implement, os } from '@orpc/server'
import { Context, Effect, Schema as EffectSchema, SchemaTransformation } from 'effect'
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

describe('output direction', () => {
  const Output = EffectSchema.Struct({ n: EffectSchema.NumberFromString })

  it('handler returns the decoded type and the client receives the encoded type', () => {
    const procedure = os.output(Output).handler(() => ({ n: 42 }))
    // @ts-expect-error the encoded type is not a valid handler output
    os.output(Output).handler(() => ({ n: '42' }))

    const client = {} as RouterClient<{ procedure: typeof procedure }>
    expectTypeOf<Awaited<ReturnType<typeof client.procedure>>>().toEqualTypeOf<{ readonly n: string }>()
  })

  it('contract-first handler returns the decoded type and the client receives the encoded type', () => {
    const contract = { procedure: oc.output(Output) }

    implement(contract).procedure.handler(() => ({ n: 42 }))
    // @ts-expect-error the encoded type is not a valid handler output
    implement(contract).procedure.handler(() => ({ n: '42' }))

    const client = {} as RouterContractClient<typeof contract>
    expectTypeOf<Awaited<ReturnType<typeof client.procedure>>>().toEqualTypeOf<{ readonly n: string }>()
  })

  it('requires services only for the direction each schema runs in', () => {
    class Formatter extends Context.Service<Formatter, { readonly format: (n: number) => string }>()('Formatter') {}

    const NeedsDecodingServices = EffectSchema.String.pipe(EffectSchema.decodeTo(EffectSchema.Number, SchemaTransformation.transformEffect({
      decode: s => Effect.gen(function* () {
        yield* Formatter
        return Number(s)
      }),
      encode: n => Effect.succeed(`${n}`),
    })))

    const NeedsEncodingServices = EffectSchema.String.pipe(EffectSchema.decodeTo(EffectSchema.Number, SchemaTransformation.transformEffect({
      decode: s => Effect.succeed(Number(s)),
      encode: n => Effect.gen(function* () {
        const formatter = yield* Formatter
        return formatter.format(n)
      }),
    })))

    os.input(NeedsEncodingServices).output(NeedsDecodingServices)
    oc.input(NeedsEncodingServices).output(NeedsDecodingServices)

    // @ts-expect-error decoding inputs requires services
    os.input(NeedsDecodingServices)
    // @ts-expect-error decoding inputs requires services
    oc.input(NeedsDecodingServices)
    // @ts-expect-error encoding outputs requires services
    os.output(NeedsEncodingServices)
    // @ts-expect-error encoding outputs requires services
    oc.output(NeedsEncodingServices)
  })
})
