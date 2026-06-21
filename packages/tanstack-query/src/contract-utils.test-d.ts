import type { ORPCError } from '@orpc/client'
import type { ContractCaller } from '@orpc/contract'
import type { PromiseWithError } from '@orpc/shared'
import type { ProcedureUtils } from './procedure-utils'
import type { SharedRouterUtils } from './router-utils'
import type { OperationContext } from './types'
import { meta, oc, type } from '@orpc/contract'
import { createContractJsonifiedUtilsFactory, createContractUtilsFactory } from './contract-utils'

const contract = {
  ping: oc.meta(meta.path(['ping'])),
  nested: {
    pong: oc
      .meta(meta.path(['nested', 'pong']))
      .errors({ BAD_GATEWAY: { data: type<string, RegExp>(vi.fn()) } })
      .input(type<string, boolean>(vi.fn()))
      .output(type<number, Date>(vi.fn())),
  },
}

describe('createContractUtilsFactory', () => {
  const caller = {} as ContractCaller<{ cache?: boolean }>

  it('infers interceptor input, output, errors types', () => {
    createContractUtilsFactory(caller, {
      mutationInterceptors: [
        async ({ context, next, input }) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

          const result = next()

          expectTypeOf(result).toEqualTypeOf<
            PromiseWithError<unknown, unknown>
          >()

          return result
        },
      ],
      scoped: {
        ping: {
          queryInterceptors: [
            async ({ context, next, input }) => {
              expectTypeOf(input).toEqualTypeOf<unknown>()
              expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

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
            mutationInterceptors: [
              async ({ context, next, input }) => {
                expectTypeOf(input).toEqualTypeOf<unknown>()
                expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

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

  it('return general and procedure utils', () => {
    const createUtils = createContractUtilsFactory(caller, {})
    const utils = createUtils(contract.nested.pong)

    expectTypeOf(utils).toEqualTypeOf<
      & Omit<SharedRouterUtils<string>, 'path'>
      & Omit<ProcedureUtils<{ cache?: boolean }, string, Date, Error | ORPCError<'BAD_GATEWAY', RegExp>>, 'path' | 'options'>
    >()
  })
})

describe('createContractJsonifiedUtilsFactory', () => {
  const caller = {} as ContractCaller<{ cache?: boolean }>

  it('infers interceptor input, output, errors types', () => {
    createContractJsonifiedUtilsFactory(caller, {
      mutationInterceptors: [
        async ({ context, next, input }) => {
          expectTypeOf(input).toEqualTypeOf<unknown>()
          expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

          const result = next()

          expectTypeOf(result).toEqualTypeOf<
            PromiseWithError<unknown, unknown>
          >()

          return result
        },
      ],
      scoped: {
        ping: {
          queryInterceptors: [
            async ({ context, next, input }) => {
              expectTypeOf(input).toEqualTypeOf<unknown>()
              expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

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
            mutationInterceptors: [
              async ({ context, next, input }) => {
                expectTypeOf(input).toEqualTypeOf<unknown>()
                expectTypeOf(context).toEqualTypeOf<{ cache?: boolean } & OperationContext>()

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

  it('return jsonified general and procedure utils', () => {
    const createUtils = createContractJsonifiedUtilsFactory(caller, {})
    const utils = createUtils(contract.nested.pong)

    expectTypeOf(utils).toEqualTypeOf<
      & SharedRouterUtils<string>
      & ProcedureUtils<{ cache?: boolean }, string, string, Error | ORPCError<'BAD_GATEWAY', string>>
    >()
  })
})
