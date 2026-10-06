import { getPathMeta, meta, minifyRouterContract, oc } from '@orpc/contract'
import z from 'zod'
import { getOpenAPIMeta, openapi } from './meta'
import { populateRouterContractOpenAPIPaths } from './router-utils'

export const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })

export const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

describe('populateRouterContractOpenAPIPaths', () => {
  it('preserves existing defs and populates missing ones from the router shape', () => {
    const contract = {
      ping: oc.input(inputSchema).meta(openapi({ summary: 'ping' })),
      pong: oc.meta(openapi({ summary: 'pong', path: '/pong/{id}' })),
      nested: {
        ping: oc.output(outputSchema).meta(openapi({ summary: 'nested.ping' })),
        pong: oc.meta(openapi({ summary: 'nested.pong', path: '/pong2/{id}' })),
      },
    }

    const populated = populateRouterContractOpenAPIPaths(contract)

    expect(getOpenAPIMeta(populated.pong)).toEqual({ summary: 'pong', path: '/pong/{id}' })
    expect(getOpenAPIMeta(populated.nested.pong)).toEqual({ summary: 'nested.pong', path: '/pong2/{id}' })

    expect(getOpenAPIMeta(populated.ping)).toEqual({ summary: 'ping', path: '/ping' })
    expect(populated.ping['~orpc'].inputSchemas).toEqual([inputSchema])

    expect(getOpenAPIMeta(populated.nested.ping)).toEqual({ summary: 'nested.ping', path: '/nested/ping' })
    expect(populated.nested.ping['~orpc'].outputSchemas).toEqual([outputSchema])
  })

  it('ignores invalid router entries while still populating valid procedures', async () => {
    expect(populateRouterContractOpenAPIPaths('invalid' as any)).toEqual('invalid')

    const contract = {
      invalid: 'invalid' as any,
      procedure: oc,
    }

    const populated = populateRouterContractOpenAPIPaths(contract)

    expect(populated.invalid).toEqual('invalid')
    expect(getOpenAPIMeta(populated.procedure)?.path).toBe('/procedure')
  })

  it('keeps meta of minified router contracts when they are extended later', () => {
    const contract = {
      ping: oc.meta(meta.path(['ping'])).meta(openapi({ method: 'GET' })),
      pong: oc.meta(meta.path(['pong'])).meta(openapi({ method: 'GET', path: '/pong' })),
    }

    const minified = minifyRouterContract(contract) as typeof contract
    const extended = oc.errors({ EXTENDED: {} }).router(minified)
    const populated = oc.errors({ EXTENDED: {} }).router(populateRouterContractOpenAPIPaths(minified))

    expect(getPathMeta(extended.pong)).toEqual(['pong'])
    expect(getOpenAPIMeta(extended.pong)).toEqual({ method: 'GET', path: '/pong' })

    expect(getPathMeta(populated.ping)).toEqual(['ping'])
    expect(getOpenAPIMeta(populated.ping)).toEqual({ method: 'GET', path: '/ping' })
    expect(getOpenAPIMeta(populated.pong)).toEqual({ method: 'GET', path: '/pong' })
  })
})
