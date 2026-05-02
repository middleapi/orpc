import type { BaseMeta } from '../tests/shared'
import type { MergedErrorMap } from './error'
import type { Meta } from './meta'
import type { ContractProcedure } from './procedure'
import type { EnhancedContractRouter, PopulatedContractRouterPaths } from './router-utils'
import type { Schema } from './schema'
import { baseErrorMap, inputSchema, outputSchema, router } from '../tests/shared'
import { oc } from './builder'

it('EnhancedContractRouter', () => {
  const enhanced = {} as EnhancedContractRouter<typeof router, { INVALID: { status: number }, BASE2: { message: string } }>

  expectTypeOf(enhanced.ping).toEqualTypeOf<
    ContractProcedure<
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<{ INVALID: { status: number }, BASE2: { message: string } }, typeof baseErrorMap>,
        BaseMeta
    >
  >()

  expectTypeOf(enhanced.nested.ping).toEqualTypeOf<
    ContractProcedure<
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<{ INVALID: { status: number }, BASE2: { message: string } }, typeof baseErrorMap>,
        BaseMeta
    >
  >()

  expectTypeOf(enhanced.pong).toEqualTypeOf<
    ContractProcedure<
      Schema<unknown, unknown>,
      Schema<unknown, unknown>,
      MergedErrorMap<{ INVALID: { status: number }, BASE2: { message: string } }, Record<never, never>>,
      Meta
    >
  >()

  expectTypeOf(enhanced.nested.pong).toEqualTypeOf<
    ContractProcedure<
      Schema<unknown, unknown>,
      Schema<unknown, unknown>,
      MergedErrorMap<{ INVALID: { status: number }, BASE2: { message: string } }, Record<never, never>>,
      Meta
    >
  >()
})

it('PopulatedContractRouterPaths', () => {
  expectTypeOf<PopulatedContractRouterPaths<typeof router>>().toEqualTypeOf(router)

  const ping = oc
    .$meta({ meta: true })
    .input(inputSchema)
    .errors(baseErrorMap)
    .output(outputSchema)
    .route({ path: '/ping' })

  expectTypeOf<PopulatedContractRouterPaths<typeof ping>>().toEqualTypeOf<
    ContractProcedure<
        typeof inputSchema,
        typeof outputSchema,
        typeof baseErrorMap & Record<never, never>,
        { meta: boolean } & Record<never, never>
    >
  >()
})
