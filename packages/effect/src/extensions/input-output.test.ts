import type { AnyRouter, RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { oc } from '@orpc/contract'
import { implement, os } from '@orpc/server'
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

describe('output direction', () => {
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

  it('decodes outputs like any Standard Schema', async () => {
    const client = createRPCClient({
      count: os.output(EffectSchema.Struct({ count: EffectSchema.NumberFromString })).handler(() => ({ count: '42' })),
    })

    await expect(client.count()).resolves.toEqual({ count: 42 })
  })

  it('encodes outputs flipped with Schema.flip', async () => {
    class Planet extends EffectSchema.Class<Planet>('Planet')({ name: EffectSchema.String }) {}

    const contract = {
      planet: oc.output(EffectSchema.flip(EffectSchema.Struct({
        createdAt: EffectSchema.DateTimeUtcFromString,
        nickname: EffectSchema.OptionFromNullOr(EffectSchema.String),
        planet: Planet,
      }))),
    }

    const client = createRPCClient(implement(contract).router({
      planet: implement(contract).planet.handler(() => ({
        createdAt: DateTime.makeUnsafe('2024-01-01T00:00:00.000Z'),
        nickname: Option.some('blue'),
        planet: new Planet({ name: 'Earth' }),
      })),
    }))

    await expect(client.planet()).resolves.toEqual({
      createdAt: '2024-01-01T00:00:00.000Z',
      nickname: 'blue',
      planet: { name: 'Earth' },
    })
  })
})
