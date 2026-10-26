import type { ORPCErrorCode } from '@orpc/client'
import type { AnySchema, ErrorMap, ErrorMapItem, MergedErrorMap, MergedSchema, Schema } from '@orpc/contract'
import type { Context } from '@orpc/server'
import { ContractBuilder } from '@orpc/contract'
import { Builder, DecoratedProcedure } from '@orpc/server'
import { Schema as EffectSchema } from 'effect'
import { toStandardSchema } from '../schema'

/**
 * Like `ErrorMapItem`, but `data` can also be an Effect Schema.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#schema-extension | Effect Integration - Schema Extension}
 */
export interface EffectErrorMapItem extends Omit<ErrorMapItem, 'data'> {
  /**
   * Standard Schema or Effect Schema used to type and validate the error data.
   */
  data?: AnySchema | EffectSchema.ConstraintDecoder<any> | undefined
}

/**
 * Like `ErrorMap`, but error `data` can also be an Effect Schema.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#schema-extension | Effect Integration - Schema Extension}
 */
export type EffectErrorMap = {
  [key in ORPCErrorCode]?: EffectErrorMapItem
}

/**
 * Converts the Effect Schemas used as error `data` in an {@link EffectErrorMap}
 * into Standard Schemas, leaving every other item untouched.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#schema-extension | Effect Integration - Schema Extension}
 */
export type ToStandardErrorMap<T extends EffectErrorMap> = T extends ErrorMap
  ? T
  : {
      [K in keyof T]: T[K] extends ErrorMapItem
        ? T[K]
        : {
            [P in keyof T[K]]: P extends 'data'
              ? T[K][P] extends infer S extends EffectSchema.ConstraintDecoder<any> ? Schema<S['Encoded'], S['Type']> : T[K][P]
              : T[K][P]
          }
    }

function isEffectConstraintDecoder(
  schema: unknown,
): schema is EffectSchema.ConstraintDecoder<any> {
  return EffectSchema.isSchema(schema)
}

function toStandardErrorMap(errors: EffectErrorMap): ErrorMap {
  const converted: EffectErrorMap = { ...errors }

  for (const [code, item] of Object.entries(errors)) {
    if (isEffectConstraintDecoder(item?.data)) {
      converted[code] = { ...item, data: toStandardSchema(item.data) }
    }
  }

  return converted as ErrorMap
}

declare module '@orpc/contract' {
  interface ContractBuilder<
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): ContractBuilder<MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInput<Schema<S['Encoded'], S['Type']>, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithOutput<Schema<S['Encoded'], S['Type']>, TErrorMap>
  }

  interface ProcedureContractBuilderWithInput<
    TInputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): ProcedureContractBuilderWithInput<TInputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInput<MergedSchema<Schema<S['Encoded'], S['Type']>, TInputSchema>, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInputOutput<TInputSchema, Schema<S['Encoded'], S['Type']>, TErrorMap>
  }

  interface ProcedureContractBuilderWithOutput<
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): ProcedureContractBuilderWithOutput<TOutputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInputOutput<Schema<S['Encoded'], S['Type']>, TOutputSchema, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithOutput<MergedSchema<Schema<S['Encoded'], S['Type']>, TOutputSchema>, TErrorMap>
  }

  interface ProcedureContractBuilderWithInputOutput<
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): ProcedureContractBuilderWithInputOutput<TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInputOutput<MergedSchema<Schema<S['Encoded'], S['Type']>, TInputSchema>, TOutputSchema, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): ProcedureContractBuilderWithInputOutput<TInputSchema, MergedSchema<Schema<S['Encoded'], S['Type']>, TOutputSchema>, TErrorMap>
  }
}

const OriginalContractBuilderErrors = ContractBuilder.prototype.errors
ContractBuilder.prototype.errors = function errors(errors: EffectErrorMap) {
  return OriginalContractBuilderErrors.bind(this)(toStandardErrorMap(errors))
}

const OriginalContractBuilderInput = ContractBuilder.prototype.input
ContractBuilder.prototype.input = function input(schema: AnySchema | EffectSchema.ConstraintDecoder<any>) {
  return OriginalContractBuilderInput.bind(this)(isEffectConstraintDecoder(schema) ? toStandardSchema(schema) : schema)
}

const OriginalContractBuilderOutput = ContractBuilder.prototype.output
ContractBuilder.prototype.output = function output(schema: AnySchema | EffectSchema.ConstraintDecoder<any>) {
  return OriginalContractBuilderOutput.bind(this)(isEffectConstraintDecoder(schema) ? toStandardSchema(schema) : schema)
}

declare module '@orpc/server' {
  interface Builder<
    TInitialContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): Builder<TInitialContext, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInput<TInitialContext, object, Schema<S['Encoded'], S['Type']>, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithOutput<TInitialContext, object, Schema<S['Encoded'], S['Type']>, TErrorMap>
  }

  interface BuilderWithMiddlewares<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): BuilderWithMiddlewares<TInitialContext, TInjectedContext, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInput<TInitialContext, TInjectedContext, Schema<S['Encoded'], S['Type']>, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithOutput<TInitialContext, TInjectedContext, Schema<S['Encoded'], S['Type']>, TErrorMap>
  }

  interface BuilderWithInput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): BuilderWithInput<TInitialContext, TInjectedContext, TInputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInput<TInitialContext, TInjectedContext, MergedSchema<Schema<S['Encoded'], S['Type']>, TInputSchema>, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, Schema<S['Encoded'], S['Type']>, TErrorMap>
  }

  interface BuilderWithOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): BuilderWithOutput<TInitialContext, TInjectedContext, TOutputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, Schema<S['Encoded'], S['Type']>, TOutputSchema, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithOutput<TInitialContext, TInjectedContext, MergedSchema<Schema<S['Encoded'], S['Type']>, TOutputSchema>, TErrorMap>
  }

  interface BuilderWithInputOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>

    input<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, MergedSchema<Schema<S['Encoded'], S['Type']>, TInputSchema>, TOutputSchema, TErrorMap>

    output<S extends EffectSchema.ConstraintDecoder<any>>(
      schema: S,
    ): BuilderWithInputOutput<TInitialContext, TInjectedContext, TInputSchema, MergedSchema<Schema<S['Encoded'], S['Type']>, TOutputSchema>, TErrorMap>

  }

  interface DecoratedProcedure<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    errors<T extends EffectErrorMap>(
      errors: T,
    ): DecoratedProcedure<TInitialContext, TInjectedContext, TInputSchema, TOutputSchema, MergedErrorMap<TErrorMap, ToStandardErrorMap<T>>>
  }
}

const OriginalBuilderErrors = Builder.prototype.errors
Builder.prototype.errors = function errors(errors: EffectErrorMap) {
  return OriginalBuilderErrors.bind(this)(toStandardErrorMap(errors))
}

const OriginalBuilderInput = Builder.prototype.input
Builder.prototype.input = function input(schema: AnySchema | EffectSchema.ConstraintDecoder<any>) {
  return OriginalBuilderInput.bind(this)(isEffectConstraintDecoder(schema) ? toStandardSchema(schema) : schema)
}

const OriginalBuilderOutput = Builder.prototype.output
Builder.prototype.output = function output(schema: AnySchema | EffectSchema.ConstraintDecoder<any>) {
  return OriginalBuilderOutput.bind(this)(isEffectConstraintDecoder(schema) ? toStandardSchema(schema) : schema)
}

const OriginalDecoratedProcedureErrors = DecoratedProcedure.prototype.errors
DecoratedProcedure.prototype.errors = function errors(errors: EffectErrorMap) {
  return OriginalDecoratedProcedureErrors.bind(this)(toStandardErrorMap(errors))
}
