import { oc } from '@orpc/contract'
import { call, os } from '@orpc/server'
import { Schema as EffectSchema, Option } from 'effect'
import { z } from 'zod'
import * as SchemaModule from '../schema'
import './input-output'

const toStandardSchemaSpy = vi.spyOn(SchemaModule, 'toStandardSchema')

beforeEach(() => {
  vi.clearAllMocks()
})

const standardSchema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const standardSchema2 = z.object({ schema2: z.number().transform(n => `${n}`) })
const effectSchema1 = EffectSchema.Struct({ schema1: EffectSchema.Number })
const effectSchema2 = EffectSchema.Struct({ schema2: EffectSchema.Number })

it('accepts both standard schema and effect schema in ContractBuilder', () => {
  const procedure = oc
    .input(standardSchema1)
    .input(effectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledTimes(2)
  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema1)
  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(2, effectSchema2)

  expect(procedure['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(procedure['~orpc'].outputSchemas).toEqual([toStandardSchemaSpy.mock.results[1]?.value, standardSchema2])
})

it('accepts both standard schema and effect schema in Builder', () => {
  const builder = os
    .input(standardSchema1)
    .input(effectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledTimes(2)
  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema1)
  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(2, effectSchema2)

  expect(builder['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(builder['~orpc'].outputSchemas).toEqual([toStandardSchemaSpy.mock.results[1]?.value, standardSchema2])
})

it('decodes the handler output', async () => {
  const output = os.output(EffectSchema.Struct({
    count: EffectSchema.NumberFromString,
    maybe: EffectSchema.OptionFromNullOr(EffectSchema.String),
  }))

  await expect(call(output.handler(() => ({ count: '5', maybe: 'x' })))).resolves.toEqual({ count: 5, maybe: Option.some('x') })
})
