import type { HTTPPath } from '@orpc/client'
import type { ContractProcedureBuilder, ContractProcedureBuilderWithInput, ContractProcedureBuilderWithOutput, ContractRouterBuilder } from './builder-variants'
import type { ErrorMap, MergedErrorMap } from './error'
import type { Meta } from './meta'
import type { ContractProcedureDef } from './procedure'
import type { Route } from './route'
import type { ContractRouter } from './router'
import type { EnhanceContractRouterOptions, EnhancedContractRouter } from './router-utils'
import type { AnySchema, Schema } from './schema'
import { mergeErrorMap } from './error'
import { mergeMeta } from './meta'
import { ContractProcedure } from './procedure'
import { mergePrefix, mergeRoute, mergeTags } from './route'
import { enhanceContractRouter } from './router-utils'

export interface ContractBuilderDef<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>, EnhanceContractRouterOptions<TErrorMap> {
}

export class ContractBuilder<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  declare '~orpc': ContractBuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  constructor(def: ContractBuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>) {
    super(def)

    this['~orpc'].prefix = def.prefix
    this['~orpc'].tags = def.tags
  }

  /**
   * Reset initial meta
   */
  $meta<U extends Meta>(
    initialMeta: U,
  ): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, U & Record<never, never>> {
    /**
     * We need `& Record<never, never>` to deal with `has no properties in common with type` error
     */

    return new ContractBuilder({
      ...this['~orpc'],
      meta: initialMeta,
    })
  }

  /**
   * Reset initial route
   */
  $route(
    initialRoute: Route,
  ): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      route: initialRoute,
    })
  }

  errors<U extends ErrorMap>(
    errors: U,
  ): ContractBuilder<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  meta(
    meta: TMeta,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  route(
    route: Route,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  input<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithInput<U, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  output<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithOutput<TInputSchema, U, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      outputSchema: schema,
    })
  }

  prefix(prefix: HTTPPath): ContractRouterBuilder<TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      prefix: mergePrefix(this['~orpc'].prefix, prefix),
    })
  }

  tag(...tags: string[]): ContractRouterBuilder<TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      tags: mergeTags(this['~orpc'].tags, tags),
    })
  }

  router<T extends ContractRouter<TMeta>>(router: T): EnhancedContractRouter<T, TErrorMap> {
    return enhanceContractRouter(router, this['~orpc'])
  }
}

export const oc = new ContractBuilder<
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>,
  Record<never, never>
>({
  errorMap: {},
  route: {},
  meta: {},
})
