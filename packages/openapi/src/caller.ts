import type { ClientContext, ClientLink, ClientRest, ORPCClientOptions, ThrowableError } from '@orpc/client'
import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorFromErrorMap, ProcedureContract, RouterContract, RouterContractClient } from '@orpc/contract'
import type { PromiseWithError } from '@orpc/shared'
import type { JsonifiedClient, JsonifiedClientError, JsonifiedValue } from './types'
import { createContractCaller } from '@orpc/contract'

export interface ContractJsonifiedCaller<
  TClientContext extends ClientContext,
> {
  <
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    procedure: ProcedureContract<TInputSchema, TOutputSchema, TErrorMap>,
    ...rest: ClientRest<TClientContext, InferSchemaInput<TInputSchema>>
  ): PromiseWithError<
    JsonifiedValue<InferSchemaOutput<TOutputSchema>>,
    JsonifiedClientError<ORPCErrorFromErrorMap<TErrorMap> | ThrowableError>
  >
}

export interface ContractJsonifiedCallerOptions<
  TClientContext extends ClientContext,
> extends Pick<ORPCClientOptions<JsonifiedClient<RouterContractClient<RouterContract, TClientContext>>>, 'interceptors' | 'scoped'> {
  /**
   * An optional reference to the root router-contract.
   * When provided, the caller will automatically register the called procedure-contract
   * into the router at the path defined by `meta.path`.
   */
  contractRef?: undefined | RouterContract
}

export function createContractJsonifiedCaller<
  TClientContext extends ClientContext,
>(
  link: ClientLink<TClientContext>,
  options: ContractJsonifiedCallerOptions<TClientContext> = {},
): ContractJsonifiedCaller<TClientContext> {
  return createContractCaller(link, options) as ContractJsonifiedCaller<TClientContext>
}
