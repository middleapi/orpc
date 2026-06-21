import type { ProcedureContractBuilderWithInput, ProcedureContractBuilderWithOutput } from './builder-variants'
import type { ErrorMap } from './error'
import type { MergedErrorMap } from './error-utils'
import type { MetaPlugin } from './meta'
import type { ProcedureContractDefinition } from './procedure'
import type { RouterContract } from './router'
import type { AugmentedContractRouter } from './router-utils'
import type { AnySchema, Schema } from './schema'
import { toArray } from '@orpc/shared'
import { mergeErrorMap } from './error-utils'
import { getHiddenMetaPlugins } from './meta'
import { resolveMetaPlugins } from './meta-utils'
import { ProcedureContract } from './procedure'
import { augmentContractRouter } from './router-utils'

export type InitialInputSchema = Schema<void, unknown>
export type InitialOutputSchema = Schema<unknown>

export class ContractBuilder<
  TErrorMap extends ErrorMap,
> extends ProcedureContract<InitialInputSchema, InitialOutputSchema, TErrorMap> {
  /**
   * Private constructor to prevent direct instantiation.
   * Use the static `create` method to initialize a new instance with a safe initial definition.
   */
  private constructor(definition: ProcedureContractDefinition<InitialInputSchema, InitialOutputSchema, TErrorMap>) {
    super(definition)
  }

  static create(): ContractBuilder<object> {
    // The initial input schema is void for better compatibility with third-party libraries like TanStack Query,
    // for example, which allow calling mutations without input, ...
    return new ContractBuilder({
      errorMap: {},
      meta: {},
    })
  }

  meta(
    ...plugins: MetaPlugin<InitialInputSchema, InitialOutputSchema, TErrorMap>[]
  ): ContractBuilder<TErrorMap> {
    const [meta, metaPlugins] = resolveMetaPlugins(
      this['~orpc'].meta,
      this['~orpc'].metaPlugins,
      plugins,
    )

    return new ContractBuilder({
      ...this['~orpc'],
      meta,
      metaPlugins,
    }) as any
  }

  errors<T extends ErrorMap>(
    errors: T,
  ): ContractBuilder<MergedErrorMap<TErrorMap, T>> {
    let result = new ContractBuilder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })

    const plugins = getHiddenMetaPlugins(errors)
    if (plugins) {
      result = result.meta(...plugins) as any
    }

    return result as any
  }

  input<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInput<T, TErrorMap> {
    let result = new ContractBuilder({
      ...this['~orpc'],
      inputSchemas: [...toArray(this['~orpc'].inputSchemas), schema],
    })

    const plugins = getHiddenMetaPlugins(schema)
    if (plugins) {
      result = result.meta(...plugins) as any
    }

    return result as any
  }

  output<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithOutput<T, TErrorMap> {
    let result = new ContractBuilder({
      ...this['~orpc'],
      outputSchemas: [...toArray(this['~orpc'].outputSchemas), schema],
    })

    const plugins = getHiddenMetaPlugins(schema)
    if (plugins) {
      result = result.meta(...plugins) as any
    }

    return result as any
  }

  router<T extends RouterContract>(
    router: T,
  ): AugmentedContractRouter<T, TErrorMap> {
    return augmentContractRouter(router, this['~orpc'])
  }
}

export const oc = ContractBuilder.create()
