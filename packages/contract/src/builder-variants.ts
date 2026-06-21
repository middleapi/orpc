import type { InitialInputSchema, InitialOutputSchema } from './builder'
import type { ErrorMap } from './error'
import type { MergedErrorMap } from './error-utils'
import type { MetaPlugin } from './meta'
import type { ProcedureContract } from './procedure'
import type { AnySchema, MergedSchema } from './schema'

export interface ProcedureContractBuilderWithInput<
  TInputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
>extends ProcedureContract<TInputSchema, InitialOutputSchema, TErrorMap> {
  meta(
    ...plugins: MetaPlugin<TInputSchema, InitialOutputSchema, TErrorMap>[]
  ): ProcedureContractBuilderWithInput<TInputSchema, TErrorMap>

  errors<T extends ErrorMap>(
    errors: T,
  ): ProcedureContractBuilderWithInput<TInputSchema, MergedErrorMap<TErrorMap, T>>

  input<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInput<MergedSchema<T, TInputSchema>, TErrorMap>

  output<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInputOutput<TInputSchema, T, TErrorMap>
}

export interface ProcedureContractBuilderWithOutput<
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
>extends ProcedureContract<InitialInputSchema, TOutputSchema, TErrorMap> {
  meta(
    ...plugins: MetaPlugin<InitialInputSchema, TOutputSchema, TErrorMap>[]
  ): ProcedureContractBuilderWithOutput<TOutputSchema, TErrorMap>

  errors<T extends ErrorMap>(
    errors: T,
  ): ProcedureContractBuilderWithOutput<TOutputSchema, MergedErrorMap<TErrorMap, T>>

  input<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInputOutput<T, TOutputSchema, TErrorMap>

  output<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithOutput<MergedSchema<T, TOutputSchema>, TErrorMap>
}

export interface ProcedureContractBuilderWithInputOutput<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
>extends ProcedureContract<TInputSchema, TOutputSchema, TErrorMap> {
  meta(
    ...plugins: MetaPlugin<TInputSchema, TOutputSchema, TErrorMap>[]
  ): ProcedureContractBuilderWithInputOutput<TInputSchema, TOutputSchema, TErrorMap>

  errors<T extends ErrorMap>(
    errors: T,
  ): ProcedureContractBuilderWithInputOutput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, T>>

  input<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInputOutput<MergedSchema<T, TInputSchema>, TOutputSchema, TErrorMap>

  output<T extends AnySchema>(
    schema: T,
  ): ProcedureContractBuilderWithInputOutput<TInputSchema, MergedSchema<T, TOutputSchema>, TErrorMap>
}
