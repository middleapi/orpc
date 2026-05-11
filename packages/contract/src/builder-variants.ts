import type { HTTPPath } from '@orpc/client'
import type { ErrorMap, MergedErrorMap } from './error'
import type { MergedMeta, Meta } from './meta'
import type { ContractProcedure } from './procedure'
import type { Route } from './route'
import type { ContractRouter } from './router'
import type { EnhanceContractRouterOptions, EnhancedContractRouter } from './router-utils'
import type { AnySchema } from './schema'

export interface ContractProcedureBuilder<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Sets or updates the metadata for the contract.
   * The provided metadata is spared-merged with any existing metadata in the contract.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

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
  ): ContractProcedureBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the input validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithInput<U, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the output validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithOutput<TInputSchema, U, TErrorMap, TMeta, TMetaDef>
}

export interface ContractProcedureBuilderWithInput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
>extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): ContractProcedureBuilderWithInput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Sets or updates the metadata for the contract.
   * The provided metadata is spared-merged with any existing metadata in the contract.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ContractProcedureBuilderWithInput<TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

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
  ): ContractProcedureBuilderWithInput<TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the output validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithInputOutput<TInputSchema, U, TErrorMap, TMeta, TMetaDef>
}

export interface ContractProcedureBuilderWithOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): ContractProcedureBuilderWithOutput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Sets or updates the metadata for the contract.
   * The provided metadata is spared-merged with any existing metadata in the contract.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ContractProcedureBuilderWithOutput<TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

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
  ): ContractProcedureBuilderWithOutput<TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>

  /**
   * Defines the input validation schema for the contract.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<U extends AnySchema>(
    schema: U,
  ): ContractProcedureBuilderWithInputOutput<U, TOutputSchema, TErrorMap, TMeta, TMetaDef>
}

export interface ContractProcedureBuilderWithInputOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TMetaDef extends Meta = TMeta,
> extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends ErrorMap>(
    errors: U,
  ): ContractProcedureBuilderWithInputOutput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, U>, TMeta, TMetaDef>

  /**
   * Sets or updates the metadata for the contract.
   * The provided metadata is spared-merged with any existing metadata in the contract.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta<const U extends Partial<TMetaDef>>(
    meta: U,
  ): ContractProcedureBuilderWithInputOutput<TInputSchema, TOutputSchema, TErrorMap, MergedMeta<TMeta, U>, TMetaDef>

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
  ): ContractProcedureBuilderWithInputOutput<TInputSchema, TOutputSchema, TErrorMap, TMeta, TMetaDef>
}

export interface ContractRouterBuilder<
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  /**
   * This property holds the defined options for the contract router.
   */
  '~orpc': EnhanceContractRouterOptions<TErrorMap>

  /**
   * Adds type-safe custom errors to the contract.
   * The provided errors are spared-merged with any existing errors in the contract.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  'errors'<U extends ErrorMap>(
    errors: U,
  ): ContractRouterBuilder<MergedErrorMap<TErrorMap, U>, TMeta>

  /**
   * Prefixes all procedures in the contract router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  'prefix'(prefix: HTTPPath): ContractRouterBuilder <TErrorMap, TMeta>

  /**
   * Adds tags to all procedures in the contract router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  'tag'(...tags: string[]): ContractRouterBuilder <TErrorMap, TMeta>

  /**
   * Applies all of the previously defined options to the specified contract router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  'router'<T extends ContractRouter<TMeta>>(router: T): EnhancedContractRouter<T, TErrorMap>
}
