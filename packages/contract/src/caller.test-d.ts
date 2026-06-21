import type { ClientLink, ORPCError } from '@orpc/client'
import type { PromiseWithError } from '@orpc/shared'
import { oc } from './builder'
import { createContractCaller } from './caller'
import { type } from './schema-utils'

const contract = {
  ping: oc,
  nested: {
    pong: oc
      .errors({ BAD_GATEWAY: { data: type<string, RegExp>(vi.fn()) } })
      .input(type<string, boolean>(vi.fn()))
      .output(type<number, Date>(vi.fn())),
  },
}

describe('createContractCaller', () => {
  const link = {} as ClientLink<{ cache?: boolean }>

  it('infers interceptor input, output, errors types', () => {
    createContractCaller(link, {
      contractRef: contract,
      interceptors: [
        async ({ context, next, input }) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<{ cache?: boolean }>()

          const result = next()

          expectTypeOf(result).toEqualTypeOf<
            PromiseWithError<unknown, unknown>
          >()

          return result
        },
      ],
      scoped: {
        ping: {
          interceptors: [
            async ({ context, next, input }) => {
              expectTypeOf(input).toEqualTypeOf<unknown>()
              expectTypeOf(context).toEqualTypeOf<{ cache?: boolean }>()

              const result = next()

              expectTypeOf(result).toEqualTypeOf<
                PromiseWithError<unknown, Error | ORPCError<string, unknown>>
              >()

              return result
            },
          ],
        },
        nested: {
          pong: {
            interceptors: [
              async ({ context, next, input }) => {
                expectTypeOf(input).toEqualTypeOf<unknown>()
                expectTypeOf(context).toEqualTypeOf<{ cache?: boolean }>()

                const result = next()

                expectTypeOf(result).toEqualTypeOf<
                  PromiseWithError<unknown, Error | ORPCError<string, unknown>>
                >()

                return result
              },
            ],
          },
        },
      },
    })
  })

  it('infers procedure return types', () => {
    const caller = createContractCaller(link)

    expectTypeOf(
      caller(contract.ping),
    ).toEqualTypeOf<
      PromiseWithError<unknown, Error>
    >()

    expectTypeOf(
      caller(contract.nested.pong, 'string', { context: { cache: true } }),
    ).toEqualTypeOf<
      PromiseWithError<Date, Error | ORPCError<'BAD_GATEWAY', RegExp>>
    >()
  })

  it('rejects invalid input', () => {
    const caller = createContractCaller(link)

    // @ts-expect-error - invalid input
    caller(contract.nested.pong, 123)
  })

  it('rejects invalid context', () => {
    const caller = createContractCaller(link)

    // @ts-expect-error - invalid context
    caller(contract.nested.pong, 'string', { context: { cache: 'invalid' } })
  })
})
