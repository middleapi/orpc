import type { baseErrorMap, inputSchema, outputSchema } from '../tests/shared'
import type { Client } from './client'
import type { ORPCError } from './error-orpc'
import type { ContractProcedureClient } from './procedure-client'

describe('ContractProcedureClient', () => {
  it('is a client', () => {
    expectTypeOf<
      ContractProcedureClient<'context', typeof inputSchema, typeof outputSchema, typeof baseErrorMap>
    >().toEqualTypeOf<
      Client<
        'context',
        { input: number },
        { output: string },
        Error | ORPCError<'BASE', { output: string }> | ORPCError<'OVERRIDE', unknown>
      >
    >()
  })
})
