import type { ClientContext } from '@orpc/client'

import type { ProcedureContractDefinition, ProcedureContractDefinitionOf } from './procedure'
import type { ProcedureContractClient } from './procedure-client'
import type { RouterContract } from './router'

/**
 * Client type inferred from a router contract, preserving its shape.
 * Useful for typing a client without importing the server router.
 *
 * @see {@link https://orpc.dev/docs/client/client-side | Client-Side Clients}
 */
export type RouterContractClient<
  TRouter extends RouterContract,
  TClientContext extends ClientContext = object,
> = TRouter extends { '~orpc': ProcedureContractDefinition<any, any, any> }
  ? ProcedureContractClient<
      TClientContext,
      NonNullable<ProcedureContractDefinitionOf<TRouter>['__TInputSchema']>['type'],
      NonNullable<ProcedureContractDefinitionOf<TRouter>['__TOutputSchema']>['type'],
      ProcedureContractDefinitionOf<TRouter>['errorMap']
    >
  : {
      [K in keyof TRouter]: TRouter[K] extends RouterContract
        ? RouterContractClient<TRouter[K], TClientContext>
        : never
    }
