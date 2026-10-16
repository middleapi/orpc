import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Schema as EffectSchema, SchemaTransformation } from 'effect'
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

describe('defects during validation', () => {
  const secret = 'postgres://admin:hunter2@db'

  const Boom = EffectSchema.String.pipe(EffectSchema.decodeTo(EffectSchema.Number, SchemaTransformation.transform({
    decode: (s) => {
      if (s === 'boom') {
        throw new Error(`connection string ${secret}`)
      }
      return Number(s)
    },
    encode: String,
  })))

  const BoomCheck = EffectSchema.String.check(EffectSchema.makeFilter((s) => {
    if (s === 'boom') {
      throw new Error(`connection string ${secret}`)
    }
    return true
  }))

  const handler = new RPCHandler({
    transform: os.input(EffectSchema.Struct({ v: Boom })).handler(({ input }) => input.v),
    check: os.input(EffectSchema.Struct({ v: BoomCheck })).handler(({ input }) => input.v),
    output: os.output(EffectSchema.Struct({ v: BoomCheck })).handler(() => ({ v: 'boom' })),
  })

  async function call(path: string, input: unknown) {
    const { response } = await handler.handle(new Request(`http://localhost/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: input }),
    }))

    return { status: response!.status, body: await response!.text() }
  }

  it.each(['transform', 'check'])('%s: return a 500 without leaking the defect', async (path) => {
    const { status, body } = await call(path, { v: 'boom' })

    expect(status).toBe(500)
    expect(JSON.parse(body)).toEqual({
      json: { defined: false, code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    })
    expect(body).not.toContain(secret)
    expect(body).not.toContain(import.meta.dirname)
  })

  it('output: return a 500 without leaking the defect', async () => {
    const { status, body } = await call('output', undefined)

    expect(status).toBe(500)
    expect(body).not.toContain(secret)
    expect(body).not.toContain(import.meta.dirname)
  })

  it('still reports schema issues as a 400', async () => {
    const { status, body } = await call('transform', { v: 1 })

    expect(status).toBe(400)
    expect(JSON.parse(body).json.data.issues).toEqual([{ path: ['v'], message: 'Expected string' }])
  })

  it('works normally on valid input', async () => {
    expect(await call('transform', { v: '1' })).toEqual({ status: 200, body: JSON.stringify({ json: 1 }) })
    expect(await call('check', { v: 'a' })).toEqual({ status: 200, body: JSON.stringify({ json: 'a' }) })
  })
})
