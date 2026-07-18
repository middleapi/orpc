import type { AnyORPCError } from '@orpc/client'
import type { AnySchema, ErrorMap, ProcedureContractDefinition } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import type { Context } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { AnyMiddleware } from './middleware'
import { ProcedureContract } from '@orpc/contract'
import { getConstructor } from '@orpc/shared'

export interface ProcedureHandlerOptions<
  TCurrentContext extends Context,
  TInput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
> {
  context: TCurrentContext
  input: TInput
  path: string[]
  procedure: Procedure<Context, Context, AnySchema, AnySchema, ErrorMap, any>
  signal?: AbortSignal | undefined
  lastEventId?: string | undefined
  errors: TErrorConstructorMap
}

export interface ProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
> {
  (
    opts: ProcedureHandlerOptions<TCurrentContext, TInput, TErrorConstructorMap>,
    input: TInput,
  ): Promisable<THandlerOutput>
}

export interface OrderedMiddleware {
  /**
   * Snapshot of `inputSchemas.length`
   * at the time this middleware was used.
   *
   * @default 0
   */
  inputSchemasLengthAtUse?: number | undefined
  /**
   * Snapshot of `outputSchemas.length`
   * at the time this middleware was used.
   *
   * @default 0
   */
  outputSchemasLengthAtUse?: number | undefined
  middleware: AnyMiddleware
}

export interface ProcedureConfig {
  /**
   * When enabled, input schemas are not validated at runtime.
   * Schemas are still used for type inference and OpenAPI generation.
   *
   * @warning Do not disable validation for schemas that transform values.
   *
   * @default false
   */
  disableInputValidation?: boolean | undefined

  /**
   * When enabled, output schemas are not validated at runtime.
   * Schemas are still used for type inference and OpenAPI generation.
   *
   * Useful when output schemas exist only for specification generation.
   *
   * @warning Do not disable validation for schemas that transform values.
   *
   * @default false
   */
  disableOutputValidation?: boolean | undefined
}

export interface ProcedureDefinition<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
> extends ProcedureContractDefinition<TInputSchema, TOutputSchema, TErrorMap>, ProcedureConfig {
  __TInitialContext?: (type: TInitialContext) => unknown
  __TInjectedContext?: (type: TInjectedContext) => unknown
  __TReturnedError?: () => TReturnedError

  /**
   * When enabled, errors returned (not thrown) by the handler are passed through as-is,
   * rather than being transformed into inferrable errors.
   *
   * This is intended for the contract-first approach, where the procedure adheres to an
   * external contract and returned errors should not affect the inferred contract types.
   *
   * @default false
   */
  opaqueReturnedErrors?: boolean | undefined

  orderedMiddlewares: OrderedMiddleware[]
  handler: ProcedureHandler<any, any, any, any>
}

export class Procedure<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
> {
  '~orpc': ProcedureDefinition<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>

  constructor(def: ProcedureDefinition<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>) {
    this['~orpc'] = def
  }

  /**
   * Checks if the given instance satisfies the {@see Procedure} class/interface.
   */
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (this !== Procedure) {
      // fallback to default instanceof check if this is extended class
      return Function.prototype[Symbol.hasInstance].call(this, instance)
    }

    const constructor = getConstructor(instance)
    if (constructor === Procedure) {
      return true
    }

    return (
      instance instanceof ProcedureContract
      && Array.isArray((instance['~orpc'] as any).orderedMiddlewares)
      && typeof (instance['~orpc'] as any).handler === 'function'
    )
  }
}

export type AnyProcedure = Procedure<any, any, any, any, any, any>
