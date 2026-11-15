import type { RouterContractClient } from '@orpc/contract'
import type { RouterClient } from '@orpc/server'
import { os, type } from '@orpc/server'
import type { PromiseWithError } from '@orpc/shared'

import type { ORPCClientScoped, ORPCClientScopedOptions } from './client'
import { createORPCClient } from './client'
import type { ORPCError } from './error'
import type { AnyNestedClient, Client, ClientLink, InferClientContext } from './types'

const router = {
  ping: os.input(type<number>()).handler(() => 'pong'),
  nested: {
    pong: os
      .input(type<string>())
      .errors({ TEST: { data: type<string>() } })
      .handler(({ errors }) => {
        throw errors.TEST({ data: 'string' })
      }),
  },
}

describe('createORPCClient', () => {
  it('require match context between client and link', () => {
    const _1: RouterClient<typeof router, { cache: string }> = createORPCClient(
      {} as ClientLink<{ cache: string }>,
    )
    const _11: RouterClient<typeof router, { cache?: string }> = createORPCClient(
      {} as ClientLink<{ cache?: string }>,
    )
    const _111: RouterClient<typeof router, { cache?: string }> = createORPCClient(
      {} as ClientLink<{ cache?: string; tags?: string[] }>,
    )
    const _1111: RouterClient<typeof router> = createORPCClient(
      {} as ClientLink<{ cache?: string }>,
    )

    const _11111: RouterClient<typeof router> = createORPCClient(
      // @ts-expect-error -- cache is required
      {} as ClientLink<{ cache: string }>,
    )

    const _2: RouterClient<typeof router, { cache?: string }> = createORPCClient(
      // @ts-expect-error -- expect cache is optional
      {} as ClientLink<{ cache: string }>,
    )

    const _3: RouterClient<typeof router, { cache?: number }> = createORPCClient(
      // @ts-expect-error -- expect cache is number
      {} as ClientLink<{ cache?: string }>,
    )

    const _4: RouterContractClient<typeof router> = createORPCClient(
      {} as ClientLink<{ cache?: string }>,
    )

    const _44: RouterContractClient<typeof router> = createORPCClient(
      // @ts-expect-error -- cache is required
      {} as ClientLink<{ cache: string }>,
    )

    const _444: RouterContractClient<typeof router, { cache: string }> = createORPCClient(
      {} as ClientLink<{ cache: string }>,
    )
  })

  it('interceptors infer correct types', () => {
    const _client: RouterClient<typeof router, { cache: string }> = createORPCClient(
      {} as ClientLink<{ cache: string }>,
      {
        interceptors: [
          ({ input, context, next }) => {
            expectTypeOf(input).toEqualTypeOf<unknown>()
            expectTypeOf(context).toEqualTypeOf<{ cache: string }>()

            const result = next()

            expectTypeOf(result).toEqualTypeOf<
              PromiseWithError<unknown, Error | ORPCError<'TEST', string>>
            >()

            return result
          },
        ],
      },
    )
  })

  it('scoped expose correct client structure and infer correct types', () => {
    const _client: RouterClient<typeof router, { cache: string }> = createORPCClient(
      {} as ClientLink<{ cache: string }>,
      {
        scoped: {
          ping: {
            interceptors: [
              ({ input, context, next }) => {
                expectTypeOf(input).toEqualTypeOf<number>()
                expectTypeOf(context).toEqualTypeOf<{ cache: string }>()

                const result = next()

                expectTypeOf(result).toEqualTypeOf<PromiseWithError<string, Error>>()

                return result
              },
            ],
          },
          nested: {
            pong: {
              interceptors: [
                ({ input, context, next }) => {
                  expectTypeOf(input).toEqualTypeOf<string>()
                  expectTypeOf(context).toEqualTypeOf<{ cache: string }>()

                  const result = next()

                  expectTypeOf(result).toEqualTypeOf<
                    PromiseWithError<never, Error | ORPCError<'TEST', string>>
                  >()

                  return result
                },
              ],
            },
          },

          // @ts-expect-error - non exists
          nonExist: {},
        },
      },
    )
  })

  it('mixed contexts: link must accept the context of every procedure', () => {
    type Mixed = {
      a: Client<{ x: string }, string, number, Error>
      b: { c: Client<{ y: number }, string, number, Error> }
    }

    const _ok: Mixed = createORPCClient({} as ClientLink<{ x: string } | { y: number }>, {
      interceptors: [
        ({ context, next }) => {
          expectTypeOf(context).toEqualTypeOf<{ x: string } | { y: number }>()

          return next()
        },
      ],
    })

    const _loose: Mixed = createORPCClient({} as ClientLink<{ x?: string; y?: number }>)

    const _onlyA: Mixed = createORPCClient(
      // @ts-expect-error -- b.c is called with { y: number }
      {} as ClientLink<{ x: string }>,
    )

    const _both: Mixed = createORPCClient(
      // @ts-expect-error -- each call only carries one of the contexts
      {} as ClientLink<{ x: string; y: number }>,
    )
  })

  it('procedure with `never` input', () => {
    const neverRouter = { ...router, never: os.input(type<never>()).handler(() => 1) }

    const client: RouterClient<typeof neverRouter, { cache: string }> = createORPCClient(
      {} as ClientLink<{ cache: string }>,
    )

    expectTypeOf(client.ping).returns.resolves.toEqualTypeOf<string>()
  })
})

describe('ORPCClientScoped', () => {
  it('maps optional procedures', () => {
    type Scoped = ORPCClientScoped<{
      ping?: Client<{ cache: string }, number, string, Error>
      nested?: {
        pong?: Client<{ cache: string }, string, number, TypeError>
      }
    }>

    expectTypeOf<Scoped['ping']>().toEqualTypeOf<
      ORPCClientScopedOptions<{ cache: string }, number, string, Error> | undefined
    >()
    expectTypeOf<NonNullable<Scoped['nested']>['pong']>().toEqualTypeOf<
      ORPCClientScopedOptions<{ cache: string }, string, number, TypeError> | undefined
    >()
  })

  it('maps with a recursive contextual type', () => {
    // Inferring `T` must not flow back through the recursive mapped type, or TS fails with TS2321.
    type Recursive = { [k: string]: Recursive } | object
    type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }
    const client = {} as RouterClient<typeof router>

    const scoped = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => ORPCClientScoped<T>
    const _scoped: Recursive = scoped(client, { context: {} })
  })
})
