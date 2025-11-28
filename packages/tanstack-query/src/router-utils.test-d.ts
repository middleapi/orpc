import type { ErrorFromErrorMap } from '@orpc/contract'
import type { RouterClient } from '@orpc/server'
import type { baseErrorMap } from '../../contract/tests/shared'
import type { router } from '../../server/tests/shared'
import type { GeneralUtils } from './general-utils'
import type { experimental_ProcedureUtilsDefaults, ProcedureUtils } from './procedure-utils'
import type { experimental_RouterUtilsDefaults, RouterUtils } from './router-utils'
import { createRouterUtils } from './router-utils'

it('RouterUtils', () => {
  const utils = {} as RouterUtils<RouterClient<typeof router, { batch?: boolean }>>

  expectTypeOf(utils).toExtend<GeneralUtils<unknown>>()
  expectTypeOf(utils).not.toExtend<
    ProcedureUtils<any, any, any, any>
  >()

  expectTypeOf(utils.nested).toExtend<GeneralUtils<unknown>>()
  expectTypeOf(utils.nested).not.toExtend<
    ProcedureUtils<any, any, any, any>
  >()

  expectTypeOf(utils.ping).toExtend<GeneralUtils<{ input: number }>>()
  expectTypeOf(utils.ping).toExtend<
    ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
  >()

  expectTypeOf(utils.nested.ping).toExtend<GeneralUtils<{ input: number }>>()
  expectTypeOf(utils.nested.ping).toExtend<
    ProcedureUtils<{ batch?: boolean }, { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
  >()

  expectTypeOf(utils.pong).toExtend<
    ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>
  >()
  expectTypeOf(utils.nested.pong).toExtend<
    ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>
  >()
})

it('RouterUtilsDefaults', () => {
  const utils = {} as experimental_RouterUtilsDefaults<RouterClient<typeof router, { batch?: boolean }>>

  expectTypeOf(utils).not.toExtend<
    undefined | experimental_ProcedureUtilsDefaults<any, any, any, any>
  >()

  expectTypeOf(utils.nested).not.toExtend<
    undefined | experimental_ProcedureUtilsDefaults<any, any, any, any>
  >()

  expectTypeOf(utils.ping).toExtend<
    undefined | experimental_ProcedureUtilsDefaults<{ batch?: boolean }, { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
  >()

  expectTypeOf(utils.nested?.ping).toExtend<
    undefined | experimental_ProcedureUtilsDefaults<{ batch?: boolean }, { input: number }, { output: string }, ErrorFromErrorMap<typeof baseErrorMap>>
  >()

  expectTypeOf(utils.pong).toExtend<
    undefined | experimental_ProcedureUtilsDefaults<{ batch?: boolean }, unknown, unknown, Error>
  >()
  expectTypeOf(utils.nested?.pong).toExtend<
   undefined | experimental_ProcedureUtilsDefaults<{ batch?: boolean }, unknown, unknown, Error>
  >()
})

it('createRouterUtils', () => {
  const utils = createRouterUtils({} as RouterClient<typeof router, { batch?: boolean }>, {
    experimental_defaults: {
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

  expectTypeOf(utils).toEqualTypeOf<RouterUtils<RouterClient<typeof router, { batch?: boolean }>>>()
})
