import type { AnySchema, ErrorMap, MergedSchema, Schema } from '@orpc/contract'
import type { Context } from '@orpc/server'
import { ContractBuilder } from '@orpc/contract'
import { Builder } from '@orpc/server'
import { Schema as EffectSchema } from 'effect'
import { toStandardSchema } from '../schema'

declare module '@orpc/contract' {
  interface ContractBuilder<
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInput<Schema<I, A>, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithOutput<Schema<I, A>, TErrorMap>
  }

  interface ProcedureContractBuilderWithInput<
    TInputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInput<MergedSchema<Schema<I, A>, TInputSchema>, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInputOutput<TInputSchema, Schema<I, A>, TErrorMap>
  }

  interface ProcedureContractBuilderWithOutput<
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInputOutput<Schema<I, A>, TOutputSchema, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithOutput<MergedSchema<Schema<I, A>, TOutputSchema>, TErrorMap>
  }

  interface ProcedureContractBuilderWithInputOutput<
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInputOutput<MergedSchema<Schema<I, A>, TInputSchema>, TOutputSchema, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): ProcedureContractBuilderWithInputOutput<TInputSchema, MergedSchema<Schema<I, A>, TOutputSchema>, TErrorMap>
  }
}

const OriginalContractBuilderInput = ContractBuilder.prototype.input
ContractBuilder.prototype.input = function input(schema: AnySchema | EffectSchema.Schema<any, any>) {
  return OriginalContractBuilderInput.bind(this)(EffectSchema.isSchema(schema) ? toStandardSchema(schema) : schema)
}

const OriginalContractBuilderOutput = ContractBuilder.prototype.output
ContractBuilder.prototype.output = function output(schema: AnySchema | EffectSchema.Schema<any, any>) {
  return OriginalContractBuilderOutput.bind(this)(EffectSchema.isSchema(schema) ? toStandardSchema(schema) : schema)
}

declare module '@orpc/server' {
  interface Builder<
    TInitialContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInput<TInitialContext, object, Schema<I, A>, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithOutput<TInitialContext, object, Schema<I, A>, TErrorMap>
  }

  interface BuilderWithMiddlewares<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInput<TInitialContext, TInjectedContext, Schema<I, A>, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithOutput<TInitialContext, TInjectedContext, Schema<I, A>, TErrorMap>
  }

  interface BuilderWithInput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInput<TInitialContext, TInjectedContext, MergedSchema<Schema<I, A>, TInputSchema>, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, Schema<I, A>, TErrorMap>
  }

  interface BuilderWithOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, Schema<I, A>, TOutputSchema, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithOutput<TInitialContext, TInjectedContext, MergedSchema<Schema<I, A>, TOutputSchema>, TErrorMap>
  }

  interface BuilderWithInputOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    input<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, MergedSchema<Schema<I, A>, TInputSchema>, TOutputSchema, TErrorMap>

    output<A, I>(
      schema: EffectSchema.Schema<A, I>,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, MergedSchema<Schema<I, A>, TOutputSchema>, TErrorMap>

  }
}

const OriginalBuilderInput = Builder.prototype.input
Builder.prototype.input = function input(schema: AnySchema | EffectSchema.Schema<any, any>) {
  return OriginalBuilderInput.bind(this)(EffectSchema.isSchema(schema) ? toStandardSchema(schema) : schema)
}

const OriginalBuilderOutput = Builder.prototype.output
Builder.prototype.output = function output(schema: AnySchema | EffectSchema.Schema<any, any>) {
  return OriginalBuilderOutput.bind(this)(EffectSchema.isSchema(schema) ? toStandardSchema(schema) : schema)
}
