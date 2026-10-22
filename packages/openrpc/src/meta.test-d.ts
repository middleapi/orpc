import type { Schema } from '@orpc/contract'
import type { Context, Procedure } from '@orpc/server'
import type { OpenRPCMeta, OpenRPCMetaPlugin } from './meta'
import type { OpenRPCMethodObject } from './types'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { z } from 'zod'
import { getOpenRPCMeta, openrpc } from './meta'

describe('openrpc meta', () => {
  it('can be used with contracts, procedures, and routers', () => {
    oc.meta(openrpc({ summary: 'Find a planet' })).input(z.object({ id: z.number() }))
    os.meta(openrpc({ tags: ['planets'] })).input(z.object({ id: z.number() })).handler(() => {})
    os.meta(openrpc({ deprecated: true })).router({ ping: os.handler(() => 'pong') })
  })

  it('keeps the procedure types', () => {
    const procedure = os
      .input(z.object({ id: z.number() }))
      .meta(openrpc({ summary: 'Find a planet' }))
      .handler(({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ id: number }>()
        return input.id
      })

    expectTypeOf(procedure).toExtend<Procedure<Context, Context, Schema<{ id: number }, { id: number }>, Schema<number, number>, Record<never, never>>>()
  })

  it('types the meta', () => {
    expectTypeOf(openrpc({})).toEqualTypeOf<OpenRPCMetaPlugin<any, any, any>>()

    openrpc({
      summary: 'Find a planet',
      description: 'Finds a planet by id',
      deprecated: false,
      tags: ['planets'],
      externalDocs: { url: 'https://example.com', description: 'Docs' },
      examples: [
        { name: 'earth', summary: 'Earth', description: 'Finds Earth', input: { id: 1 }, output: { name: 'Earth' } },
        { name: 'notification', input: { id: 1 } },
      ],
      spec: { name: 'planet.find', params: [] },
    })

    openrpc({
      spec: (current) => {
        expectTypeOf(current).toEqualTypeOf<OpenRPCMethodObject>()
        return { ...current, summary: 'Find a planet' }
      },
    })

    // @ts-expect-error tags are names
    openrpc({ tags: [{ name: 'planets' }] })
    // @ts-expect-error examples need a name
    openrpc({ examples: [{ input: 1 }] })
    // @ts-expect-error the spec must be a Method Object
    openrpc({ spec: { summary: 'missing name and params' } })
    // @ts-expect-error unknown option
    openrpc({ paramStructure: 'by-name' })
  })

  it('getOpenRPCMeta', () => {
    expectTypeOf(getOpenRPCMeta(oc)).toEqualTypeOf<OpenRPCMeta | undefined>()
    expectTypeOf(getOpenRPCMeta(os.handler(() => {}))).toEqualTypeOf<OpenRPCMeta | undefined>()
    expectTypeOf(getOpenRPCMeta(os.lazy(() => Promise.resolve({ default: {} })))).toEqualTypeOf<OpenRPCMeta | undefined>()

    // @ts-expect-error not a procedure
    getOpenRPCMeta({})
  })
})
