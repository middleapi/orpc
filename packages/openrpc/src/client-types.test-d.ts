import type { Client, ORPCError } from '@orpc/client'
import type { RouterClient } from '@orpc/server'
import type { JsonRpcResultValue, OpenRPCClient } from './client-types'
import { createORPCClient } from '@orpc/client'
import { os } from '@orpc/server'
import { z } from 'zod'

describe('JsonRpcResultValue', () => {
  it('sends void and undefined as null', () => {
    expectTypeOf<JsonRpcResultValue<void>>().toEqualTypeOf<null>()
    expectTypeOf<JsonRpcResultValue<undefined>>().toEqualTypeOf<null>()
    expectTypeOf<JsonRpcResultValue<void | undefined>>().toEqualTypeOf<null>()
  })

  it('sends optional values as nullable', () => {
    expectTypeOf<JsonRpcResultValue<string | undefined>>().toEqualTypeOf<string | null>()
    expectTypeOf<JsonRpcResultValue<Date | undefined>>().toEqualTypeOf<string | null>()
    expectTypeOf<JsonRpcResultValue<{ a: Date } | undefined>>().toEqualTypeOf<{ a: string } | null>()
    expectTypeOf<JsonRpcResultValue<string | null | undefined>>().toEqualTypeOf<string | null>()
  })

  it('jsonifies other values', () => {
    expectTypeOf<JsonRpcResultValue<string>>().toEqualTypeOf<string>()
    expectTypeOf<JsonRpcResultValue<null>>().toEqualTypeOf<null>()
    expectTypeOf<JsonRpcResultValue<Date>>().toEqualTypeOf<string>()
    expectTypeOf<JsonRpcResultValue<bigint>>().toEqualTypeOf<string>()
    expectTypeOf<JsonRpcResultValue<Set<Date>>>().toEqualTypeOf<string[]>()
    expectTypeOf<JsonRpcResultValue<Map<string, Date>>>().toEqualTypeOf<[string, string][]>()
    expectTypeOf<JsonRpcResultValue<{ a: Date, b?: number }>>().toEqualTypeOf<{ a: string, b?: number }>()
  })

  it('keeps any and unknown', () => {
    expectTypeOf<JsonRpcResultValue<any>>().toBeAny()
    expectTypeOf<JsonRpcResultValue<unknown>>().toBeUnknown()
  })
})

describe('OpenRPCClient', () => {
  it('maps a client', () => {
    expectTypeOf<OpenRPCClient<
      Client<{ cache?: boolean }, { now: Date }, { b: Set<Date> }, Error | ORPCError<'NOT_FOUND', { at: Date }>>
    >>().toEqualTypeOf<
      Client<{ cache?: boolean }, { now: Date }, { b: string[] }, Error | ORPCError<'NOT_FOUND', { at: string }>>
    >()
  })

  it('maps undefined outputs to null', () => {
    expectTypeOf<OpenRPCClient<Client<Record<never, never>, void, void, Error>>>()
      .toEqualTypeOf<Client<Record<never, never>, void, null, Error>>()
    expectTypeOf<OpenRPCClient<Client<Record<never, never>, string, Date | undefined, Error>>>()
      .toEqualTypeOf<Client<Record<never, never>, string, string | null, Error>>()
  })

  it('maps nested clients', () => {
    expectTypeOf<OpenRPCClient<{
      ping: Client<Record<never, never>, undefined, void, Error>
      planet: {
        find: Client<Record<never, never>, { id: number }, { at: Date }, ORPCError<'NOT_FOUND', { id: bigint }>>
      }
    }>>().toEqualTypeOf<{
      ping: Client<Record<never, never>, undefined, null, Error>
      planet: {
        find: Client<Record<never, never>, { id: number }, { at: string }, ORPCError<'NOT_FOUND', { id: string }>>
      }
    }>()
  })

  it('types a client created from a router', async () => {
    const router = {
      ping: os.handler(() => {}),
      planet: {
        find: os
          .input(z.object({ id: z.number() }))
          .errors({ NOT_FOUND: { data: z.object({ at: z.date() }) } })
          .handler(({ input }) => ({ id: input.id, createdAt: new Date() })),
      },
    }

    const client = createORPCClient<OpenRPCClient<RouterClient<typeof router>>>({} as any)

    expectTypeOf(await client.ping()).toEqualTypeOf<null>()
    expectTypeOf(await client.planet.find({ id: 1 })).toEqualTypeOf<{ id: number, createdAt: string }>()

    // @ts-expect-error input is still validated
    await client.planet.find({ id: '1' })
  })
})
