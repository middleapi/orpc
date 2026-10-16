import type { AnyRouter, RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { getHiddenMetaPlugins, oc, setHiddenMetaPlugins } from '@orpc/contract'
import { call, implement, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { DateTime, Schema as EffectSchema, Option } from 'effect'
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

  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema1)

  expect(procedure['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(procedure['~orpc'].outputSchemas).toEqual([expect.objectContaining({ schema: effectSchema2 }), standardSchema2])
})

it('accepts both standard schema and effect schema in Builder', () => {
  const builder = os
    .input(standardSchema1)
    .input(effectSchema1)
    .output(effectSchema2)
    .output(standardSchema2)

  expect(toStandardSchemaSpy).toHaveBeenNthCalledWith(1, effectSchema1)

  expect(builder['~orpc'].inputSchemas).toEqual([standardSchema1, toStandardSchemaSpy.mock.results[0]?.value])
  expect(builder['~orpc'].outputSchemas).toEqual([expect.objectContaining({ schema: effectSchema2 }), standardSchema2])
})

describe.each([
  ['ContractBuilder', (schema: EffectSchema.Codec<any, any>) => [oc.input(schema)['~orpc'].inputSchemas![0]!, oc.output(schema)['~orpc'].outputSchemas![0]!] as const],
  ['Builder', (schema: EffectSchema.Codec<any, any>) => [os.input(schema)['~orpc'].inputSchemas![0]!, os.output(schema)['~orpc'].outputSchemas![0]!] as const],
] as const)('effect schema direction in %s', (_, toStandardSchemas) => {
  it('decodes inputs and encodes outputs, even with the same schema', async () => {
    const [inputSchema, outputSchema] = toStandardSchemas(EffectSchema.Struct({ n: EffectSchema.NumberFromString }))

    expect(await inputSchema['~standard'].validate({ n: '42' })).toEqual({ value: { n: 42 } })
    expect(await inputSchema['~standard'].validate({ n: 42 })).toHaveProperty('issues')

    expect(await outputSchema['~standard'].validate({ n: 42 })).toEqual({ value: { n: '42' } })
    expect(await outputSchema['~standard'].validate({ n: '42' })).toHaveProperty('issues')
  })

  it('keeps hidden meta plugins', () => {
    const schema = EffectSchema.Struct({ n: EffectSchema.Number })
    const plugin = { name: 'plugin1' }
    setHiddenMetaPlugins(schema, [plugin])

    const [inputSchema, outputSchema] = toStandardSchemas(schema)

    expect(getHiddenMetaPlugins(inputSchema)).toEqual([plugin])
    expect(getHiddenMetaPlugins(outputSchema)).toEqual([plugin])
  })
})

it('reuses one converted output schema per effect schema', () => {
  const schema = EffectSchema.Struct({ n: EffectSchema.Number })

  expect(os.output(schema)['~orpc'].outputSchemas![0]).toBe(oc.output(schema)['~orpc'].outputSchemas![0])
})

describe('output encoding', () => {
  class Planet extends EffectSchema.Class<Planet>('Planet')({ name: EffectSchema.String }) {}

  const PlanetOutput = EffectSchema.Struct({
    count: EffectSchema.NumberFromString,
    createdAt: EffectSchema.DateTimeUtcFromString,
    nickname: EffectSchema.OptionFromNullOr(EffectSchema.String),
    planet: Planet,
  })

  const createdAt = DateTime.makeUnsafe('2024-01-01T00:00:00.000Z')

  const decoded = {
    count: 42,
    createdAt,
    nickname: Option.some('blue'),
    planet: new Planet({ name: 'Earth' }),
  }

  const encoded = {
    count: '42',
    createdAt: '2024-01-01T00:00:00.000Z',
    nickname: 'blue',
    planet: { name: 'Earth' },
  }

  function createRPCClient<T extends AnyRouter>(router: T): RouterClient<T> {
    const handler = new RPCHandler(router)

    return createORPCClient(new RPCLink({
      origin: 'http://localhost',
      url: '/rpc',
      fetch: async (url, init) => {
        const { response } = await handler.handle(new Request(url, init), { prefix: '/rpc' })
        return response ?? new Response('Not Found', { status: 404 })
      },
    }))
  }

  it('lets the handler return the decoded type', async () => {
    const procedure = os.output(PlanetOutput).handler(() => decoded)

    await expect(call(procedure, undefined)).resolves.toEqual(encoded)
  })

  it('rejects encoded handler outputs', async () => {
    const procedure = os.output(PlanetOutput).handler(() => encoded as any)

    await expect(call(procedure, undefined)).rejects.toThrow('Output validation failed')
  })

  it('round trips over RPCHandler and RPCLink', async () => {
    const client = createRPCClient({
      planet: os.output(PlanetOutput).handler(() => decoded),
    })

    const output = await client.planet()

    expect(output).toEqual(encoded)
    expect(EffectSchema.decodeUnknownSync(PlanetOutput)(output)).toEqual(decoded)
  })

  it('round trips contract-first procedures over RPCHandler and RPCLink', async () => {
    const contract = { planet: oc.output(PlanetOutput) }
    const client = createRPCClient(implement(contract).router({
      planet: implement(contract).planet.handler(() => decoded),
    }))

    await expect(client.planet()).resolves.toEqual(encoded)
  })
})
