import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import type { RouterClient } from '@orpc/server'
import type { ProcedureUtils, ProcedureUtilsOptions } from './procedure-utils'
import type { RouterUtils, RouterUtilsScoped, SharedRouterUtils } from './router-utils'
import { os } from '@orpc/server'
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

const scopedRouter = {
  ping,
  pong,
  nested: os.router({
    ping,
    pong,
  }),
}

describe('SharedRouterUtils', () => {
  const utils = {} as SharedRouterUtils<{ a: { b: { c: number } } }>

  it('.key', () => {
    utils.key()
    utils.key({})
    utils.key({ type: 'mutation' })
    utils.key({ input: {}, type: 'query' })
    utils.key({ input: {}, type: 'streamed', fnOptions: { refetchMode: 'append' } })
    utils.key({ input: {} })
    utils.key({ input: { a: {} } })
    utils.key({ input: { a: { b: {} } } })
    utils.key({ input: { a: { b: { c: 1 } } } })

    // @ts-expect-error invalid input
    utils.key({ input: 123 })
    // @ts-expect-error invalid input
    utils.key({ input: { a: { b: { c: '1' } } } })

    // @ts-expect-error invalid input
    utils.key({ type: 'ddd' })

    // @ts-expect-error input is not allowed when type is mutation
    utils.key({ type: 'mutation', input: {} })
    // @ts-expect-error fnOptions is not allowed when type not streamed
    utils.key({ type: 'infinite', fnOptions: { refetchMode: 'append' } })
  })
})

it('RouterUtils', () => {
  type G = RouterClient<typeof scopedRouter, { batch?: boolean }>['nested']['ping']
  const utils = {} as RouterUtils<RouterClient<typeof scopedRouter, { batch?: boolean }>>

  expectTypeOf(utils).toExtend<Omit<SharedRouterUtils<unknown>, 'path'>>()
  expectTypeOf<typeof utils>().not.toExtend<
    ProcedureUtils<any, any, any, any>
  >()

  expectTypeOf(utils.nested).toExtend<Omit<SharedRouterUtils<unknown>, 'path'>>()
  expectTypeOf<typeof utils.nested>().not.toExtend<
    ProcedureUtils<any, any, any, any>
  >()

  expectTypeOf(utils.ping).toExtend<Omit<SharedRouterUtils<{ input: number }>, 'path'>>()
  expectTypeOf(utils.ping).toExtend<
    Omit<ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>, 'path' | 'options'>
  >()

  expectTypeOf(utils.nested.ping).toExtend<Omit<SharedRouterUtils<{ input: number }>, 'path'>>()
  expectTypeOf(utils.nested.ping).toExtend<
    Omit<ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>, 'path' | 'options'>
  >()

  expectTypeOf(utils.pong).toExtend<
    Omit<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>, 'path' | 'options'>
  >()
  expectTypeOf(utils.nested.pong).toExtend<
    Omit<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>, 'path' | 'options'>
  >()
})

it('RouterUtilsScoped', () => {
  const utils = {} as RouterUtilsScoped<RouterClient<typeof scopedRouter, { batch?: boolean }>>

  expectTypeOf<typeof utils>().not.toExtend<
    undefined | ProcedureUtilsOptions<any, any, any, any>
  >()

  expectTypeOf<typeof utils.nested>().not.toExtend<
    undefined | ProcedureUtilsOptions<any, any, any, any>
  >()

  expectTypeOf(utils.ping).toExtend<
    undefined | ProcedureUtilsOptions<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>
  >()

  expectTypeOf(utils.nested?.ping).toExtend<
    undefined | ProcedureUtilsOptions<{ batch?: boolean }, { input: number }, { output: string }, ORPCErrorFromErrorMap<typeof baseErrorMap> | Error>
  >()

  expectTypeOf(utils.pong).toExtend<
    undefined | ProcedureUtilsOptions<{ batch?: boolean }, unknown, unknown, Error>
  >()
  expectTypeOf(utils.nested?.pong).toExtend<
   undefined | ProcedureUtilsOptions<{ batch?: boolean }, unknown, unknown, Error>
  >()
})

it('createRouterUtils', () => {
  createRouterUtils({} as RouterClient<typeof scopedRouter, { batch?: boolean }>, {
    // @ts-expect-error path option was replaced by prefix
    path: ['base'],
  })

  const utils = createRouterUtils({} as RouterClient<typeof scopedRouter, { batch?: boolean }>, {
    prefix: '__prefix__',
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
  })

  expectTypeOf(utils).toEqualTypeOf<RouterUtils<RouterClient<typeof scopedRouter, { batch?: boolean }>>>()
})
