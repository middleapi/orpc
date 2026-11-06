import { getConstructor, isNonPrimitive } from '@orpc/shared'

import type { ErrorMap } from './error.ts'
import type { AnyMetaPlugin, Meta } from './meta.ts'
import type { AnySchema } from './schema.ts'

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
    if (this !== ProcedureContract) {
      // fallback to default instanceof check if this is extended class
      return Function.prototype[Symbol.hasInstance].call(this, instance)
    }

    const constructor = getConstructor(instance)
    if (constructor === ProcedureContract) {
      return true
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
