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
  /**
   * This property holds the defined options for the contract.
   */
  declare '~orpc': ContractBuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>

  constructor(def: ContractBuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>) {
    super(def)

    this['~orpc'].prefix = def.prefix
    this['~orpc'].tags = def.tags
  }

  /**
   * Sets or overrides the initial meta.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
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
   * Sets or overrides the initial route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  $route(
    initialRoute: Route,
  ): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      route: initialRoute,
    })
  }

  /**
   * Sets or overrides the initial input schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#initial-configuration Initial Procedure Configuration Docs}
   */
  $input<U extends AnySchema>(
    initialInputSchema?: U,
  ): ContractBuilder<U, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      inputSchema: initialInputSchema,
    })
  }

  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): ContractBuilder<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      errorMap: mergeErrorMap(this['~orpc'].errorMap, errors),
    })
  }

  /**
   * Sets or updates the metadata for the contract.
   * The provided metadata is spared-merged with any existing metadata in the contract.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta(
    meta: TMeta,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      meta: mergeMeta(this['~orpc'].meta, meta),
    })
  }

  /**
   * Sets or updates the route definition for the contract.
   * The provided route is spared-merged with any existing route in the contract.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  route(
    route: Route,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      route: mergeRoute(this['~orpc'].route, route),
    })
  }

  /**
   * Defines the input validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithInput<U, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      inputSchema: schema,
    })
  }

  /**
   * Defines the output validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithOutput<TInputSchema, U, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      outputSchema: schema,
    })
  }

  /**
   * Prefixes all procedures in the contract router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  prefix(prefix: HTTPPath): ContractRouterBuilder<TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      prefix: mergePrefix(this['~orpc'].prefix, prefix),
    })
  }

  /**
   * Adds tags to all procedures in the contract router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  tag(...tags: string[]): ContractRouterBuilder<TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this['~orpc'],
      tags: mergeTags(this['~orpc'].tags, tags),
    })
  }

  /**
   * Applies all of the previously defined options to the specified contract router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
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
