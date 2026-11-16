import type { SafeClient } from './client-safe'
import type { ORPCError } from './error'
import type { AnyNestedClient, Client, ClientContext, InferClientContext } from './types'

describe('SafeClient', () => {
  const client = {} as {
    ping: Client<ClientContext, string, number, Error | ORPCError<'BAD_GATEWAY', { val: string }>>
    nested: {
      pong: Client<ClientContext, { id: number }, { result: string }, Error>
    }
  }

  it('maps procedures to safe results', async () => {
    const safeClient = {} as SafeClient<typeof client>

    const pingResult = await safeClient.ping('test')
    expectTypeOf(pingResult.error).toEqualTypeOf<
      Error | ORPCError<'BAD_GATEWAY', { val: string }> | null
    >()
    expectTypeOf(pingResult.data).toEqualTypeOf<number | undefined>()
    expectTypeOf(pingResult.definedError).toEqualTypeOf<ORPCError<
      'BAD_GATEWAY',
      { val: string }
    > | null>()
    expectTypeOf(pingResult.isSuccess).toEqualTypeOf<boolean>()

    const pongResult = await safeClient.nested.pong({ id: 123 })
    expectTypeOf(pongResult.error).toEqualTypeOf<Error | null>()
    expectTypeOf(pongResult.data).toEqualTypeOf<{ result: string } | undefined>()
    expectTypeOf(pongResult.definedError).toEqualTypeOf<null>()
    expectTypeOf(pongResult.isSuccess).toEqualTypeOf<boolean>()
  })

  it('maps optional procedures', async () => {
    const safeClient = {} as SafeClient<{
      ping?: Client<ClientContext, string, number, Error>
      nested?: {
        pong?: Client<ClientContext, { id: number }, { result: string }, Error>
      }
    }>

    const pingResult = await safeClient.ping?.('test')
    expectTypeOf(pingResult?.data).toEqualTypeOf<number | undefined>()

    const pongResult = await safeClient.nested?.pong?.({ id: 123 })
    expectTypeOf(pongResult?.data).toEqualTypeOf<{ result: string } | undefined>()
  })

  it('maps with a recursive contextual type', () => {
    // Inferring `T` must not flow back through the recursive mapped type, or TS fails with TS2321.
    type Recursive = { [k: string]: Recursive } | object
    type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }

    const safe = {} as <T extends AnyNestedClient>(client: T, options: Options<T>) => SafeClient<T>
    const _safe: Recursive = safe(client, { context: {} })
  })
})
