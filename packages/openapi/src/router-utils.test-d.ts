import type { ProcedureContract, Schema } from '@orpc/contract'
import { oc } from '@orpc/contract'
import * as z from 'zod'

import type { PopulatedRouterContractOpenAPIPaths } from './router-utils'
import { populateRouterContractOpenAPIPaths } from './router-utils'

const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })
const outputSchema = z.object({ output: z.number().transform((n) => `${n}`) })

const ping = oc.input(inputSchema).output(outputSchema)
const pong = oc.errors({ PONG: { message: 'pong' } })

describe('PopulatedRouterContractOpenAPIPaths', () => {
  it('preserves the router-contract shape', () => {
    const populated = populateRouterContractOpenAPIPaths({ ping, nested: { pong } })

    expectTypeOf(populated).toEqualTypeOf<{
      ping: ProcedureContract<typeof inputSchema, typeof outputSchema, {}>
      nested: {
        pong: ProcedureContract<
          Schema<void, unknown>,
          Schema<unknown, unknown>,
          { PONG: { message: string } }
        >
      }
    }>()
  })

  it('maps optional keys', () => {
    expectTypeOf<
      PopulatedRouterContractOpenAPIPaths<{ ping?: typeof ping; nested?: { pong?: typeof pong } }>
    >().toEqualTypeOf<{
      ping?: ProcedureContract<typeof inputSchema, typeof outputSchema, {}> | undefined
      nested?:
        | {
            pong?:
              | ProcedureContract<
                  Schema<void, unknown>,
                  Schema<unknown, unknown>,
                  { PONG: { message: string } }
                >
              | undefined
          }
        | undefined
    }>()
  })
})
