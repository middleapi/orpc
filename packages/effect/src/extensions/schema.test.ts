import { isDefinedError } from '@orpc/client'
import { oc, setHiddenMetaPlugins } from '@orpc/contract'
import { call, os } from '@orpc/server'
import { Schema as EffectSchema } from 'effect'
import { z } from 'zod'
import * as SchemaModule from '../schema'
import './schema'

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

describe('.errors', () => {
  const errors = {
    STANDARD: { message: 'standard', data: standardSchema1 },
    EFFECT: { message: 'effect', data: effectSchema1 },
    NO_DATA: { message: 'no data' },
  }

  it('accepts both standard schema and effect schema in ContractBuilder', () => {
    const procedure = oc
      .errors({ BASE: { data: effectSchema2 } })
      .input(standardSchema1)
      .errors(errors)

    expect(toStandardSchemaSpy).toHaveBeenCalledTimes(2)
    expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema2)
    expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(2, effectSchema1)

    expect(procedure['~orpc'].errorMap).toEqual({
      BASE: { data: toStandardSchemaSpy.mock.results[0]?.value },
      STANDARD: { message: 'standard', data: standardSchema1 },
      EFFECT: { message: 'effect', data: toStandardSchemaSpy.mock.results[1]?.value },
      NO_DATA: { message: 'no data' },
    })
  })

  it('accepts both standard schema and effect schema in Builder', () => {
    const builder = os
      .errors({ BASE: { data: effectSchema2 } })
      .input(standardSchema1)
      .errors(errors)

    expect(toStandardSchemaSpy).toHaveBeenCalledTimes(2)
    expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema2)
    expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(2, effectSchema1)

    expect(builder['~orpc'].errorMap).toEqual({
      BASE: { data: toStandardSchemaSpy.mock.results[0]?.value },
      STANDARD: { message: 'standard', data: standardSchema1 },
      EFFECT: { message: 'effect', data: toStandardSchemaSpy.mock.results[1]?.value },
      NO_DATA: { message: 'no data' },
    })
  })

  it('accepts both standard schema and effect schema in DecoratedProcedure', () => {
    const procedure = os
      .handler(() => 'output')
      .errors(errors)

    expect(toStandardSchemaSpy).toHaveBeenCalledTimes(1)
    expect(toStandardSchemaSpy).toHaveBeenCalledWith(effectSchema1)

    expect(procedure['~orpc'].errorMap).toEqual({
      STANDARD: { message: 'standard', data: standardSchema1 },
      EFFECT: { message: 'effect', data: toStandardSchemaSpy.mock.results[0]?.value },
      NO_DATA: { message: 'no data' },
    })
  })

  it('keeps error maps without effect schema as is', () => {
    const errors = { STANDARD: { data: standardSchema1 } }
    const metaPlugin = { name: 'test' }
    setHiddenMetaPlugins(errors, [metaPlugin])

    const builder = os.errors(errors)

    expect(toStandardSchemaSpy).not.toHaveBeenCalled()
    expect(builder['~orpc'].errorMap.STANDARD).toBe(errors.STANDARD)
    expect(builder['~orpc'].metaPlugins).toEqual([metaPlugin])
  })

  it('keeps hidden meta plugins of error maps with effect schema', () => {
    const errors = { EFFECT: { data: effectSchema1 } }
    const metaPlugin = { name: 'test' }
    setHiddenMetaPlugins(errors, [metaPlugin])

    expect(oc.errors(errors)['~orpc'].metaPlugins).toEqual([metaPlugin])
    expect(os.errors(errors)['~orpc'].metaPlugins).toEqual([metaPlugin])
    expect(os.handler(() => 'output').errors(errors)['~orpc'].metaPlugins).toEqual([metaPlugin])
  })

  it('validates and decodes error data with effect schema', async () => {
    const procedure = os
      .errors({ EFFECT: { data: EffectSchema.Struct({ value: EffectSchema.NumberFromString }) } })
      .handler(({ errors }) => {
        throw errors.EFFECT({ data: { value: '123' } })
      })

    const error = await call(procedure, undefined).catch(e => e)

    expect(isDefinedError(error)).toBe(true)
    expect(error.code).toBe('EFFECT')
    expect(error.data).toEqual({ value: 123 })
  })
})
