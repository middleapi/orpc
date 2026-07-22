import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import type { RouterClient } from '@orpc/server'
import type { Public } from '@orpc/shared'
import type { ProcedureUtils } from './procedure-utils'
import type { RouterUtils, SharedRouterUtils } from './router-utils'
import { os } from '@orpc/server'
import { ref } from 'vue'
import z from 'zod'
import { createRouterUtils } from './router-utils'

const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })
const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })
const unknownSchema = z.unknown()

const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

const ping = os.input(inputSchema).output(outputSchema).errors(baseErrorMap).handler(() => ({ output: 1 }))
const pong = os.input(unknownSchema).output(unknownSchema).handler(() => 'pong')

const router = {
  ping,
  pong,
  nested: os.router({
    ping,
    pong,
  }),
}

describe('SharedRouterUtils', () => {
  const utils = {} as Public<SharedRouterUtils<{ a: { b: { c: number } } }>>

  it('.key', () => {
    utils.key()
    utils.key({})
    utils.key({ type: 'mutation' })
    // unlike tanstack-query, mutation keys can contain input
    utils.key({ type: 'mutation', input: {} })
    utils.key({ input: {}, type: 'query' })
    utils.key({ input: {}, type: 'streamed', fnOptions: { refetchMode: 'append' } })
    utils.key({ input: {} })
    utils.key({ input: { a: {} } })
    utils.key({ input: { a: { b: {} } } })
    utils.key({ input: { a: { b: { c: 1 } } } })
    utils.key({ back: 1 })
    utils.key({ back: 1, type: 'query' })

    // @ts-expect-error invalid back
    utils.key({ back: '1' })

    // @ts-expect-error invalid input
    utils.key({ input: 123 })
    // @ts-expect-error invalid input
    utils.key({ input: { a: { b: { c: '1' } } } })

    // @ts-expect-error not allow ref
    utils.key({ input: { a: { b: ref({ c: 1 }) } } })

    // @ts-expect-error invalid type
    utils.key({ type: 'ddd' })

    // @ts-expect-error fnOptions is only allowed for streamed type
    utils.key({ type: 'infinite', fnOptions: { refetchMode: 'append' } })
  })
})

it('RouterUtils', () => {
  const utils = {} as RouterUtils<RouterClient<typeof router, { batch?: boolean }>>

  expectTypeOf(utils).toExtend<Public<SharedRouterUtils<unknown>>>()
  expectTypeOf(utils.nested).toExtend<Public<SharedRouterUtils<unknown>>>()

  expectTypeOf(utils.ping).toExtend<Public<SharedRouterUtils<{ input: number }>>>()
  expectTypeOf(utils.nested.ping).toExtend<Public<SharedRouterUtils<{ input: number }>>>()

  expectTypeOf(utils.ping).toExtend<
    Public<ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>>
  >()
  expectTypeOf(utils.nested.ping).toExtend<
    Public<ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>>
  >()

  expectTypeOf(utils.pong).toExtend<
    Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
  >()
  expectTypeOf(utils.nested.pong).toExtend<
    Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
  >()
})

it('createRouterUtils', () => {
  const utils = createRouterUtils({} as RouterClient<typeof router, { batch?: boolean }>, {
    prefix: '__prefix__',
    queryInterceptors: [
      ({ next, context, path }) => {
        expectTypeOf(context.batch).toEqualTypeOf<boolean | undefined>()
        expectTypeOf(path).toEqualTypeOf<string[]>()

        return next()
      },
    ],
    mutationInterceptors: [
      ({ next, context }) => {
        expectTypeOf(context.batch).toEqualTypeOf<boolean | undefined>()

        return next()
      },
    ],
    scoped: {
      nested: {
        ping: {
          mutationOptions: {
            onSuccess: (output) => {
              expectTypeOf(output).toEqualTypeOf<{ output: string }>()
            },
          },
        },
      },
    },
    plugins: [
      {
        name: 'test-plugin',
        init: options => options,
        initProcedureOptions: (path, options) => {
          expectTypeOf(path).toEqualTypeOf<string[]>()

          return options
        },
      },
    ],
  })

  expectTypeOf(utils).toEqualTypeOf<RouterUtils<RouterClient<typeof router, { batch?: boolean }>>>()
})
