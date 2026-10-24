import type { AnyMetaPlugin } from '@orpc/contract'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { oc, setHiddenMetaPlugins } from '@orpc/contract'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
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

it('accepts both standard schema and effect schema in ContractBuilder', () => {
  const procedure = oc
    .input(standardSchema1)
    .input(effectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardSchemaSpy).toHaveBeenCalledWith(effectSchema1)
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledWith(effectSchema2)

  expect(procedure['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(procedure['~orpc'].outputSchemas).toEqual([toStandardOutputSchemaSpy.mock.results[0]?.value, standardSchema2])
})

it('accepts both standard schema and effect schema in Builder', () => {
  const builder = os
    .input(standardSchema1)
    .input(effectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)

  expect(toStandardSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardSchemaSpy).toHaveBeenCalledWith(effectSchema1)
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledOnce()
  expect(toStandardOutputSchemaSpy).toHaveBeenCalledWith(effectSchema2)

  expect(builder['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(builder['~orpc'].outputSchemas).toEqual([toStandardOutputSchemaSpy.mock.results[0]?.value, standardSchema2])
})

it('keeps effect schemas already converted to standard schemas as output', () => {
  const decoding = EffectSchema.toStandardSchemaV1(effectSchema1)
  const encoding = EffectSchema.toStandardSchemaV1(EffectSchema.flip(effectSchema2))

  expect(oc.output(decoding).output(encoding)['~orpc'].outputSchemas).toEqual([decoding, encoding])
  expect(os.output(decoding).output(encoding)['~orpc'].outputSchemas).toEqual([decoding, encoding])
  expect(toStandardOutputSchemaSpy).not.toHaveBeenCalled()
})

it('applies meta plugins of effect output schemas', () => {
  const metaPlugin: AnyMetaPlugin = {
    name: 'test',
    init: m => ({ ...m, metaPlugin: true }),
  }

  const schema = EffectSchema.Struct({ value: EffectSchema.String })
  setHiddenMetaPlugins(schema, [metaPlugin])

  expect(oc.output(schema)['~orpc'].meta).toEqual(expect.objectContaining({ metaPlugin: true }))
  expect(os.output(schema)['~orpc'].meta).toEqual(expect.objectContaining({ metaPlugin: true }))
})

describe('round trip through RPCHandler and RPCLink', () => {
  const Payload = EffectSchema.Struct({
    count: EffectSchema.NumberFromString,
    maybe: EffectSchema.OptionFromNullOr(EffectSchema.String),
    at: EffectSchema.DateFromString,
  })

  const router = {
    decode: os
      .input(Payload)
      .handler(({ input }) => ({
        count: input.count + 1,
        maybe: Option.getOrElse(input.maybe, () => 'none'),
        at: input.at.toISOString(),
      })),
    encode: os
      .output(Payload)
      .handler(() => ({
        count: 5,
        maybe: Option.some('x'),
        at: new Date('2026-01-02T03:04:05.000Z'),
      })),
    encodeNone: os
      .output(Payload)
      .handler(() => ({
        count: 5,
        maybe: Option.none(),
        at: new Date('2026-01-02T03:04:05.000Z'),
      })),
    encoded: os
      .output(Payload)
      .handler(() => ({ count: '5', maybe: 'x', at: '2026-01-02T03:04:05.000Z' }) as any),
  }

  const handler = new RPCHandler(router)

  const client = createORPCClient<any>(new RPCLink({
    origin: 'http://localhost',
    fetch: async (url, init) => {
      const { response } = await handler.handle(new Request(url, init))

      return response ?? new Response(null, { status: 404 })
    },
  }))

  it('decodes input', async () => {
    await expect(client.decode({ count: '5', maybe: 'x', at: '2026-01-02T03:04:05.000Z' })).resolves.toEqual({
      count: 6,
      maybe: 'x',
      at: '2026-01-02T03:04:05.000Z',
    })

    await expect(client.decode({ count: '5', maybe: null, at: '2026-01-02T03:04:05.000Z' })).resolves.toEqual({
      count: 6,
      maybe: 'none',
      at: '2026-01-02T03:04:05.000Z',
    })
  })

  it('encodes output', async () => {
    await expect(client.encode()).resolves.toEqual({ count: '5', maybe: 'x', at: '2026-01-02T03:04:05.000Z' })
    await expect(client.encodeNone()).resolves.toEqual({ count: '5', maybe: null, at: '2026-01-02T03:04:05.000Z' })
  })

  it('rejects output that is already encoded', async () => {
    await expect(client.encoded()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Output validation failed',
    })
  })
})
