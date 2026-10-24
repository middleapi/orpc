import { oc } from '@orpc/contract'
import { call, os } from '@orpc/server'
import { Schema as EffectSchema, Option } from 'effect'
import { z } from 'zod'
import * as SchemaModule from '../schema'
import './input-output'

const toStandardSchemaSpy = vi.spyOn(SchemaModule, 'toStandardSchema')
const toStandardOutputSchemaSpy = vi.spyOn(SchemaModule, 'toStandardOutputSchema')

beforeEach(() => {
  vi.clearAllMocks()
})

const standardSchema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const standardSchema2 = z.object({ schema2: z.number().transform(n => `${n}`) })
const effectSchema1 = EffectSchema.Struct({ schema1: EffectSchema.Number })
const effectSchema2 = EffectSchema.Struct({ schema2: EffectSchema.Number })
const convertedEffectSchema1 = EffectSchema.toStandardSchemaV1(effectSchema1)
const convertedEffectSchema2 = EffectSchema.toStandardSchemaV1(effectSchema2)

it('accepts standard schema, effect schema, and converted effect schema in ContractBuilder', () => {
  const procedure = oc
    .input(standardSchema1)
    .input(effectSchema1)
    .input(convertedEffectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)
    .output(convertedEffectSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardSchemaSpy).toHaveBeenCalledWith(effectSchema1)
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledWith(effectSchema2)

  expect(procedure['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value, convertedEffectSchema1])
  expect(procedure['~orpc'].outputSchemas).toEqual([toStandardOutputSchemaSpy.mock.results[0]?.value, standardSchema2, convertedEffectSchema2])
})

it('accepts standard schema, effect schema, and converted effect schema in Builder', () => {
  const builder = os
    .input(standardSchema1)
    .input(effectSchema1)
    .input(convertedEffectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)
    .output(convertedEffectSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardSchemaSpy).toHaveBeenCalledWith(effectSchema1)
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledWith(effectSchema2)

  expect(builder['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value, convertedEffectSchema1])
  expect(builder['~orpc'].outputSchemas).toEqual([toStandardOutputSchemaSpy.mock.results[0]?.value, standardSchema2, convertedEffectSchema2])
})

it('encodes the handler output', async () => {
  const output = os.output(EffectSchema.Struct({
    count: EffectSchema.NumberFromString,
    maybe: EffectSchema.OptionFromNullOr(EffectSchema.String),
  }))

  await expect(call(output.handler(() => ({ count: 5, maybe: Option.some('x') })))).resolves.toEqual({ count: '5', maybe: 'x' })

  await expect(call(output.handler(() => ({ count: '5', maybe: 'x' }) as any))).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Output validation failed',
  })
})
