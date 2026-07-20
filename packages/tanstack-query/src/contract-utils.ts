import type { ClientContext, ThrowableError } from '@orpc/client'
import type { AnySchema, ContractCaller, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorFromErrorMap, ProcedureContract, ProcedureContractClient, RouterContract, RouterContractClient } from '@orpc/contract'
import type { JsonifiedClient, JsonifiedClientError, JsonifiedValue } from '@orpc/openapi'
import type { Public } from '@orpc/shared'
import type { ProcedureUtils } from './procedure-utils'
import type { RouterUtilsOptions, SharedRouterUtils } from './router-utils'
import { getPathMeta } from '@orpc/contract'
import { get } from '@orpc/shared'
import { createRouterUtils } from './router-utils'

export interface ContractUtilsFactory<TClientContext extends ClientContext> {
  <
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    procedure: ProcedureContract<TInputSchema, TOutputSchema, TErrorMap>
  ):
    & Public<SharedRouterUtils<InferSchemaInput<TInputSchema>>>
    & Public<ProcedureUtils<TClientContext, InferSchemaInput<TInputSchema>, InferSchemaOutput<TOutputSchema>, ORPCErrorFromErrorMap<TErrorMap> | ThrowableError>>
}

export interface ContractUtilsFactoryOptions<
  TClientContext extends ClientContext,
> extends Omit<RouterUtilsOptions<RouterContractClient<RouterContract, TClientContext>>, 'path'> {
}

export function createContractUtilsFactory<
  TClientContext extends ClientContext,
>(
  caller: ContractCaller<TClientContext>,
  options: ContractUtilsFactoryOptions<TClientContext>,
): ContractUtilsFactory<TClientContext> {
  return <
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    procedure: ProcedureContract<TInputSchema, TOutputSchema, TErrorMap>,
  ) => {
    const path = getPathMeta(procedure)

    if (!path) {
      throw new TypeError(
        'ContractUtilsFactory: procedure contract must define `meta.path` that matches its path in the root router contract.',
      )
    }

    const scoped = get(options.scoped, path)

    if (scoped !== undefined && (scoped === null || typeof scoped !== 'object')) {
      throw new TypeError(
        `ContractUtilsFactory: "scoped" at path "${path.join('.')}" must be an object or undefined, got "${scoped}".`,
      )
    }

    const client: ProcedureContractClient<TClientContext, TInputSchema, TOutputSchema, TErrorMap>
      = (...rest) => caller(procedure, ...rest)

    return createRouterUtils(client, {
      ...options as any,
      path,
      scoped,
    })
  }
}

export interface ContractJsonifiedUtilsFactory<TClientContext extends ClientContext> {
  <
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  >(
    procedure: ProcedureContract<TInputSchema, TOutputSchema, TErrorMap>
  ):
    & SharedRouterUtils<InferSchemaInput<TInputSchema>>
    & ProcedureUtils<TClientContext, InferSchemaInput<TInputSchema>, JsonifiedValue<InferSchemaOutput<TOutputSchema>>, JsonifiedClientError<ORPCErrorFromErrorMap<TErrorMap> | ThrowableError>>
}

export interface ContractJsonifiedUtilsFactoryOptions<
  TClientContext extends ClientContext,
> extends RouterUtilsOptions<JsonifiedClient<RouterContractClient<RouterContract, TClientContext>>> {
}

export function createContractJsonifiedUtilsFactory<
  TClientContext extends ClientContext,
>(
  caller: ContractCaller<TClientContext>,
  options: ContractJsonifiedUtilsFactoryOptions<TClientContext>,
): ContractJsonifiedUtilsFactory<TClientContext> {
  return createContractUtilsFactory(caller, options) as ContractJsonifiedUtilsFactory<TClientContext>
}
