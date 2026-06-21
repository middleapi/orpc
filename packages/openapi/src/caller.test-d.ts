import type { ClientLink, ORPCError } from '@orpc/client'
import type { PromiseWithError } from '@orpc/shared'
import { oc, type } from '@orpc/contract'
import { createContractJsonifiedCaller } from './caller'

const contract = {
  ping: oc,
  nested: {
    pong: oc
      .errors({ BAD_GATEWAY: { data: type<string, RegExp>(vi.fn()) } })
      .input(type<string, boolean>(vi.fn()))
      .output(type<number, Date>(vi.fn())),
  },
}

describe('createContractJsonifiedCaller', () => {
  const link = {} as ClientLink<{ cache?: boolean }>

  it('infers interceptor input, output, errors types', () => {
    createContractJsonifiedCaller(link, {
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
    const caller = createContractJsonifiedCaller(link)

    expectTypeOf(
      caller(contract.ping),
    ).toEqualTypeOf<
      PromiseWithError<unknown, Error>
    >()

    expectTypeOf(
      caller(contract.nested.pong, 'string', { context: { cache: true } }),
    ).toEqualTypeOf<
      PromiseWithError<string, Error | ORPCError<'BAD_GATEWAY', string>>
    >()
  })

  it('rejects invalid input', () => {
    const caller = createContractJsonifiedCaller(link)

    // @ts-expect-error - invalid input
    caller(contract.nested.pong, 123)
  })

  it('rejects invalid context', () => {
    const caller = createContractJsonifiedCaller(link)

    // @ts-expect-error - invalid context
    caller(contract.nested.pong, 'string', { context: { cache: 'invalid' } })
  })
})
