import type { AnyNestedClient, Client, InferClientContext } from '@orpc/client'
import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import type { RouterClient } from '@orpc/server'
import { os } from '@orpc/server'
import type { Public } from '@orpc/shared'
import * as z from 'zod'

import type { ProcedureUtils } from './procedure-utils'
import type { RouterUtils } from './router-utils'
import { createRouterUtils } from './router-utils'
import type { SharedUtils } from './shared-utils'

const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })
const outputSchema = z.object({ output: z.number().transform((n) => `${n}`) })
const unknownSchema = z.unknown()

const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

const ping = os
  .input(inputSchema)
  .output(outputSchema)
  .errors(baseErrorMap)
  .handler(() => ({ output: 1 }))
const pong = os
  .input(unknownSchema)
  .output(unknownSchema)
  .handler(() => 'pong')

const router = {
  ping,
  pong,
  nested: os.router({
    ping,
    pong,
  }),
}

type OptionalClient = {
  ping?: Client<{ batch?: boolean }, string, number, Error>
  nested?: {
    pong?: Client<{ batch?: boolean }, string, number, Error>
  }
}

describe('RouterUtils', () => {
  it('maps procedures', () => {
    const utils = {} as RouterUtils<RouterClient<typeof router, { batch?: boolean }>>

    expectTypeOf(utils).toExtend<Public<SharedUtils<unknown>>>()
    expectTypeOf(utils.nested).toExtend<Public<SharedUtils<unknown>>>()

    expectTypeOf(utils.ping).toExtend<Public<SharedUtils<{ input: number }>>>()
    expectTypeOf(utils.nested.ping).toExtend<Public<SharedUtils<{ input: number }>>>()

    expectTypeOf(utils.ping).toExtend<
      Public<
        ProcedureUtils<
          { batch?: boolean },
          { input: number },
          { output: string },
          ORPCErrorFromErrorMap<typeof baseErrorMap> | Error
        >
      >
    >()
    expectTypeOf(utils.nested.ping).toExtend<
      Public<
        ProcedureUtils<
          { batch?: boolean },
          { input: number },
          { output: string },
          ORPCErrorFromErrorMap<typeof baseErrorMap> | Error
        >
      >
    >()

    expectTypeOf(utils.pong).toExtend<
      Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
    >()
    expectTypeOf(utils.nested.pong).toExtend<
      Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
    >()
  })

  it('maps optional procedures', () => {
    const utils = {} as RouterUtils<OptionalClient>

    expectTypeOf(utils.ping).toEqualTypeOf<
      Public<ProcedureUtils<{ batch?: boolean }, string, number, Error>> | undefined
    >()
    expectTypeOf(utils.nested?.pong).toEqualTypeOf<
      Public<ProcedureUtils<{ batch?: boolean }, string, number, Error>> | undefined
    >()
  })

  it('maps with a recursive contextual type', () => {
    // Inferring `T` must not flow back through the recursive mapped type, or TS fails with TS2321.
    type Recursive = { [k: string]: Recursive } | object
    type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }
    const client = {} as RouterClient<typeof router, { batch?: boolean }>

    const utils = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => RouterUtils<T>
    const _utils: Recursive = utils(client, { context: {} })
  })
})

describe('createRouterUtils', () => {
  it('infers router utils', () => {
    const utils = createRouterUtils({} as RouterClient<typeof router, { batch?: boolean }>, {
      prefix: '__prefix__',
    })

    expectTypeOf(utils).toEqualTypeOf<
      RouterUtils<RouterClient<typeof router, { batch?: boolean }>>
    >()
  })
})
