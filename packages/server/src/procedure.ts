import type {
  AnySchema,
  ErrorMap,
  ORPCErrorConstructorMap,
  ProcedureContractDefinition,
} from '@orpc/contract'
import { ProcedureContract } from '@orpc/contract'
import type { Promisable } from '@orpc/shared'
import { getConstructor } from '@orpc/shared'

import type { Context } from './context.ts'
import type { AnyMiddleware } from './middleware.ts'

export interface ProcedureHandlerOptions<
  TCurrentContext extends Context,
  TInput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
> {
  context: TCurrentContext
  input: TInput
  path: string[]
  procedure: Procedure<Context, Context, AnySchema, AnySchema, ErrorMap>
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

export interface ProcedureValidationOptions {
  /**
   * Whether input schemas are validated at runtime.
   *
   * @default true
   */
  input?: boolean | undefined

  /**
   * Whether output schemas are validated at runtime.
   *
   * Disable this when output schemas exist only for specification generation.
   *
   * @default true
   */
  output?: boolean | undefined
}

export interface ProcedureConfig {
  /**
   * Runtime validation of input and output schemas. `false` disables both,
   * {@link ProcedureValidationOptions} controls each separately.
   *
   * Schemas are still used for type inference and OpenAPI generation when validation is disabled.
   * Each `$config` call only overrides the directions it sets.
   *
   * @remarks
   * **Warning**: Do not disable validation for schemas that transform values.
   *
   * @default true
   */
  validation?: boolean | ProcedureValidationOptions | undefined
}

export interface ProcedureDefinition<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
>
  extends ProcedureContractDefinition<TInputSchema, TOutputSchema, TErrorMap>, ProcedureConfig {
  __TInitialContext?: (type: TInitialContext) => unknown
  __TInjectedContext?: (type: TInjectedContext) => unknown

  orderedMiddlewares: OrderedMiddleware[]
  handler: ProcedureHandler<any, any, any, any>
}

export class Procedure<
  TInitialContext extends Context,
  TInjectedContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  '~orpc': ProcedureDefinition<
    TInitialContext,
    TInjectedContext,
    TInputSchema,
    TOutputSchema,
    TErrorMap
  >

  'constructor'(
    def: ProcedureDefinition<
      TInitialContext,
      TInjectedContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap
    >,
  ) {
    this['~orpc'] = def
  }

  /**
   * Checks if the given instance satisfies the {@link Procedure} class/interface.
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
      instance instanceof ProcedureContract &&
      Array.isArray((instance['~orpc'] as any).orderedMiddlewares) &&
      typeof (instance['~orpc'] as any).handler === 'function'
    )
  }
}

export type AnyProcedure = Procedure<any, any, any, any, any>
