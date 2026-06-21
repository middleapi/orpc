import type { ClientContext, ClientLink, ClientRest, ORPCClientOptions, ThrowableError } from '@orpc/client'
import type { PromiseWithError } from '@orpc/shared'
import type { ErrorMap, ORPCErrorFromErrorMap } from './error'
import type { ProcedureContract } from './procedure'
import type { ProcedureContractClient } from './procedure-client'
import type { RouterContract } from './router'
import type { RouterContractClient } from './router-client'
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './schema'
import { createORPCClient } from '@orpc/client'
import { get, set } from '@orpc/shared'
import { getPathMeta } from './meta-built-in'

export interface ContractCaller<
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
    InferSchemaOutput<TOutputSchema>,
    ORPCErrorFromErrorMap<TErrorMap> | ThrowableError
  >
}

export interface ContractCallerOptions<
  TClientContext extends ClientContext,
> extends Pick<ORPCClientOptions<RouterContractClient<RouterContract, TClientContext>>, 'interceptors' | 'scoped'> {
  /**
   * An optional reference to the root router-contract.
   * When provided, the caller will automatically register the called procedure-contract
   * into the router at the path defined by `meta.path`.
   */
  contractRef?: undefined | RouterContract
}

export function createContractCaller<
  TClientContext extends ClientContext,
>(
  link: ClientLink<TClientContext>,
  options: ContractCallerOptions<TClientContext> = {},
): ContractCaller<TClientContext> {
  // Use async here so all errors are rejected through the returned Promise.
  return async <
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    procedure: ProcedureContract<TInputSchema, TOutputSchema, TErrorMap>,
    ...rest: ClientRest<TClientContext, InferSchemaInput<TInputSchema>>
  ) => {
    const path = getPathMeta(procedure)

    if (!path) {
      throw new TypeError(
        'ContractCaller: procedure contract must define `meta.path` that matches its path in the root router contract.',
      )
    }

    if (options.contractRef) {
      set(options.contractRef, [...path, '~orpc'], procedure['~orpc'])
    }

    const scoped = get(options.scoped, path)

    if (scoped !== undefined && (scoped === null || typeof scoped !== 'object')) {
      throw new TypeError(
        `ContractCaller: "scoped" at path "${path.join('.')}" must be an object or undefined, got "${scoped}".`,
      )
    }

    const client: ProcedureContractClient<TClientContext, TInputSchema, TOutputSchema, TErrorMap>
      = createORPCClient(link, { path, interceptors: options.interceptors as any, scoped: scoped as any })

    return client(...rest)
  }
}
