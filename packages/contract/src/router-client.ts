import type { ClientContext } from '@orpc/client'
import type { ContractProcedure } from './procedure'
import type { ContractProcedureClient } from './procedure-client'
import type { AnyContractRouter } from './router'

export type ContractRouterClient<TRouter extends AnyContractRouter, TClientContext extends ClientContext = Record<never, never>>
  = TRouter extends ContractProcedure<infer UInputSchema, infer UOutputSchema, infer UErrorMap, any>
    ? ContractProcedureClient<TClientContext, UInputSchema, UOutputSchema, UErrorMap>
    : {
        [K in keyof TRouter]: TRouter[K] extends AnyContractRouter ? ContractRouterClient<TRouter[K], TClientContext> : never
      }
