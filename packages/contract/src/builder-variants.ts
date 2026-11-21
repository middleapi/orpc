import type { InitialInputSchema, InitialOutputSchema } from './builder'
import type { ErrorMap } from './error'
import type { MergedErrorMap } from './error-utils'
import type { MetaPlugin } from './meta'
import type { ProcedureContract } from './procedure'
import type { AnySchema, MergedSchema } from './schema'

/**
 * The contract builder variant returned after `.input` is called.
 * It is already a complete procedure contract that can still be refined.
 *
 * @see {@link https://orpc.dev/docs/contract/procedure | Procedure Contract}
 */
export interface ContractBuilderWithInput<
  TInputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends ProcedureContract<TInputSchema, InitialOutputSchema, TErrorMap> {
  /**
   * Applies metadata plugins to contracts built from this builder.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#metadata | Procedure Contract - Metadata}
   */
  meta(
    ...plugins: MetaPlugin<TInputSchema, InitialOutputSchema, TErrorMap>[]
  ): ContractBuilderWithInput<TInputSchema, TErrorMap>

  /**
   * Defines typesafe errors that implementations of this contract can throw.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#typesafe-errors | Procedure Contract - Typesafe Errors}
   */
  errors<T extends ErrorMap>(
    errors: T,
  ): ContractBuilderWithInput<TInputSchema, MergedErrorMap<TErrorMap, T>>

  /**
   * Adds an additional input schema, merged with the previously defined one.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#multiple-schemas | Procedure Contract - Multiple Schemas}
   */
  input<T extends AnySchema>(
    schema: T,
  ): ContractBuilderWithInput<MergedSchema<T, TInputSchema>, TErrorMap>

  /**
   * Defines the output schema used to validate and type the procedure output.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#inputoutput-validation | Procedure Contract - Input/Output Validation}
   */
  output<T extends AnySchema>(schema: T): ContractBuilderWithInputOutput<TInputSchema, T, TErrorMap>
}

/**
 * The contract builder variant returned after `.output` is called.
 * It is already a complete procedure contract that can still be refined.
 *
 * @see {@link https://orpc.dev/docs/contract/procedure | Procedure Contract}
 */
export interface ContractBuilderWithOutput<
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends ProcedureContract<InitialInputSchema, TOutputSchema, TErrorMap> {
  /**
   * Applies metadata plugins to contracts built from this builder.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#metadata | Procedure Contract - Metadata}
   */
  meta(
    ...plugins: MetaPlugin<InitialInputSchema, TOutputSchema, TErrorMap>[]
  ): ContractBuilderWithOutput<TOutputSchema, TErrorMap>

  /**
   * Defines typesafe errors that implementations of this contract can throw.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#typesafe-errors | Procedure Contract - Typesafe Errors}
   */
  errors<T extends ErrorMap>(
    errors: T,
  ): ContractBuilderWithOutput<TOutputSchema, MergedErrorMap<TErrorMap, T>>

  /**
   * Defines the input schema used to validate and type the procedure input.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#inputoutput-validation | Procedure Contract - Input/Output Validation}
   */
  input<T extends AnySchema>(schema: T): ContractBuilderWithInputOutput<T, TOutputSchema, TErrorMap>

  /**
   * Adds an additional output schema, merged with the previously defined one.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#multiple-schemas | Procedure Contract - Multiple Schemas}
   */
  output<T extends AnySchema>(
    schema: T,
  ): ContractBuilderWithOutput<MergedSchema<T, TOutputSchema>, TErrorMap>
}

/**
 * The contract builder variant returned after both `.input` and `.output`
 * are called. It is already a complete procedure contract that can still be
 * refined.
 *
 * @see {@link https://orpc.dev/docs/contract/procedure | Procedure Contract}
 */
export interface ContractBuilderWithInputOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> extends ProcedureContract<TInputSchema, TOutputSchema, TErrorMap> {
  /**
   * Applies metadata plugins to contracts built from this builder.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#metadata | Procedure Contract - Metadata}
   */
  meta(
    ...plugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[]
  ): ContractBuilderWithInputOutput<TInputSchema, TOutputSchema, TErrorMap>

  /**
   * Defines typesafe errors that implementations of this contract can throw.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#typesafe-errors | Procedure Contract - Typesafe Errors}
   */
  errors<T extends ErrorMap>(
    errors: T,
  ): ContractBuilderWithInputOutput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, T>>

  /**
   * Adds an additional input schema, merged with the previously defined one.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#multiple-schemas | Procedure Contract - Multiple Schemas}
   */
  input<T extends AnySchema>(
    schema: T,
  ): ContractBuilderWithInputOutput<MergedSchema<T, TInputSchema>, TOutputSchema, TErrorMap>

  /**
   * Adds an additional output schema, merged with the previously defined one.
   *
   * @see {@link https://orpc.dev/docs/contract/procedure#multiple-schemas | Procedure Contract - Multiple Schemas}
   */
  output<T extends AnySchema>(
    schema: T,
  ): ContractBuilderWithInputOutput<TInputSchema, MergedSchema<T, TOutputSchema>, TErrorMap>
}
