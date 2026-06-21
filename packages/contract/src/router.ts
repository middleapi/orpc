import type { ThrowableError } from '@orpc/shared'
import type { ORPCErrorFromErrorMap } from './error'
import type { AnyProcedureContract, ProcedureContract } from './procedure'
import type { InferSchemaInput, InferSchemaOutput } from './schema'

export type RouterContract
  = | AnyProcedureContract
    | {
      [k: string]: RouterContract
    }

export type InferRouterContractInputs<T extends RouterContract>
  = T extends ProcedureContract<infer UInputSchema, any, any>
    ? InferSchemaInput<UInputSchema>
    : {
        [K in keyof T]: T[K] extends RouterContract ? InferRouterContractInputs<T[K]> : never
      }

export type InferRouterContractOutputs<T extends RouterContract>
  = T extends ProcedureContract<any, infer UOutputSchema, any>
    ? InferSchemaOutput<UOutputSchema>
    : {
        [K in keyof T]: T[K] extends RouterContract ? InferRouterContractOutputs<T[K]> : never
      }

export type InferRouterContractErrorMap<T extends RouterContract>
  = T extends ProcedureContract<any, any, infer UErrorMap>
    ? UErrorMap
    : {
        [K in keyof T]: T[K] extends RouterContract ? InferRouterContractErrorMap<T[K]> : never
      }[keyof T]

/**
 * Infer the union of throwable errors for entire router-contract.
 */
export type InferRouterContractError<T extends RouterContract>
  = T extends ProcedureContract<any, any, infer UErrorMap>
    ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
    : {
        [K in keyof T]: T[K] extends RouterContract ? InferRouterContractError<T[K]> : never
      }[keyof T]

/**
 * Infer throwable errors for each procedure-contract, preserving the router-contract shape.
 */
export type InferRouterContractErrors<T extends RouterContract>
  = T extends ProcedureContract<any, any, infer UErrorMap>
    ? ORPCErrorFromErrorMap<UErrorMap> | ThrowableError
    : {
        [K in keyof T]: T[K] extends RouterContract ? InferRouterContractErrors<T[K]> : never
      }
