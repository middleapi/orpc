import type { Client, ClientContext, NestedClient, ORPCError, ThrowableError } from '@orpc/client'
import { z } from 'zod'

import { oc } from './builder'
import type { AnyProcedureContract } from './procedure'
import type { RouterContractClient } from './router-client'

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const ping = oc.input(z.object({ input: z.number().transform((n) => `${n}`) }))
const pong = oc.output(z.object({ output: z.string().transform((s) => Number(s)) })).errors({
  INTERNAL_SERVER_ERROR: {
    data: z.object({ id: z.string().transform((s) => Number(s)) }),
  },
})

const router = {
  ping,
  pong,
  nested: {
    ping,
    pong,
  },
}

describe('RouterContractClient', () => {
  it('is a NestedClient', () => {
    expectTypeOf<RouterContractClient<typeof router, ClientContext>>().toExtend<
      NestedClient<ClientContext>
    >()
  })

  it('maps to ProcedureContractClient', () => {
    type ClientType = RouterContractClient<typeof router, { cache?: boolean }>

    expectTypeOf<ClientType['ping']>().toEqualTypeOf<
      Client<{ cache?: boolean }, { input: number }, unknown, ThrowableError>
    >()

    expectTypeOf<ClientType['pong']>().toEqualTypeOf<
      Client<
        { cache?: boolean },
        void,
        { output: number },
        ThrowableError | ORPCError<'INTERNAL_SERVER_ERROR', { id: number }>
      >
    >()

    expectTypeOf<ClientType['nested']['ping']>().toEqualTypeOf<ClientType['ping']>()

    expectTypeOf<ClientType['nested']['pong']>().toEqualTypeOf<ClientType['pong']>()
  })

  it('accepts any client as RouterContractClient<any>', () => {
    const client = {} as RouterContractClient<typeof router>

    const _router: RouterContractClient<any> = client
    const _procedure: RouterContractClient<any> = client.ping
    const _key: RouterContractClient<{ ping: any }> = { ping: client.pong }
  })

  it('keeps a generic procedure unresolved', async () => {
    async function _generic<T extends AnyProcedureContract>(client: RouterContractClient<T>) {
      // @ts-expect-error - output of an unresolved procedure is not a string
      const _output: string = await client(undefined as any)
    }
  })
})
