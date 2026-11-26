import { isNonPrimitive } from '@orpc/shared'

import type { ErrorMap } from './error'
import type { AnyMetaPlugin, Meta } from './meta'
import type { AnySchema } from './schema'

export interface ProcedureContractDefinition<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  __TInputSchema?: { type: TInputSchema }
  __TOutputSchema?: { type: TOutputSchema }

  /**
   * Non-serializable should be optional
   */
  inputSchemas?: AnySchema[] | undefined
  outputSchemas?: AnySchema[] | undefined
  metaPlugins?: AnyMetaPlugin[] | undefined
  errorMap: TErrorMap
  meta: Meta
}

export class ProcedureContract<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> {
  '~orpc': ProcedureContractDefinition<TInputSchema, TOutputSchema, TErrorMap>

  'constructor'(def: ProcedureContractDefinition<TInputSchema, TOutputSchema, TErrorMap>) {
    this['~orpc'] = def
  }

  /**
   * Checks if the given instance satisfies the {@link ProcedureContract} class/interface.
   */
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, instance)) {
      return true
    }

    if (this !== ProcedureContract) {
      return false
    }

    return (
      isNonPrimitive(instance) &&
      isNonPrimitive(instance['~orpc']) &&
      isNonPrimitive(instance['~orpc'].errorMap) &&
      isNonPrimitive(instance['~orpc'].meta) &&
      (instance['~orpc'].inputSchemas === undefined ||
        Array.isArray(instance['~orpc'].inputSchemas)) &&
      (instance['~orpc'].outputSchemas === undefined ||
        Array.isArray(instance['~orpc'].outputSchemas))
    )
  }
}

export type AnyProcedureContract = ProcedureContract<any, any, any>
