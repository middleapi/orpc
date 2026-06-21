import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, InitialInputSchema, Schema } from '@orpc/contract'
import type { AnyORPCError, Context, DecoratedProcedure, ImplementedProcedure, MergedContext, ORPCErrorConstructorMap } from '@orpc/server'
import type { Effect } from 'effect'
import type { YieldWrap } from 'effect/Utils'
import type { WithEffectContext } from '../context'
import type { HandlerGen, InferYieldError } from '../handler'
import { Builder, ProcedureImplementer } from '@orpc/server'
import { handlerGen } from '../handler'

declare module '@orpc/server' {
  interface Builder<
    TInitialContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    effect<
      TYield extends YieldWrap<Effect.Effect<
        any,
        any,
        TInitialContext extends WithEffectContext<infer S> ? S : never
      >>,
      TReturn,
    >(
      handler: HandlerGen<
        TInitialContext,
        InferSchemaOutput<InitialInputSchema>,
        TYield,
        TReturn,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): DecoratedProcedure<
      TInitialContext,
      object,
      InitialInputSchema,
      Schema<Exclude<TReturn, AnyORPCError>>,
      TErrorMap,
      Extract<TReturn | InferYieldError<TYield>, AnyORPCError>
    >
  }

  interface BuilderWithMiddlewares<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TErrorMap extends ErrorMap,
  > {
    effect<
      TYield extends YieldWrap<Effect.Effect<
        any,
        any,
        MergedContext<TInitialContext, TInjectedContext> extends WithEffectContext<infer S> ? S : never
      >>,
      TReturn,
    >(
      handler: HandlerGen<
        MergedContext<TInitialContext, TInjectedContext>,
        InferSchemaOutput<InitialInputSchema>,
        TYield,
        TReturn,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): DecoratedProcedure<
      TInitialContext,
      TInjectedContext,
      InitialInputSchema,
      Schema<Exclude<TReturn, AnyORPCError>>,
      TErrorMap,
      Extract<TReturn | InferYieldError<TYield>, AnyORPCError>
    >
  }

  interface BuilderWithInput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    effect<
      TYield extends YieldWrap<Effect.Effect<
        any,
        any,
        MergedContext<TInitialContext, TInjectedContext> extends WithEffectContext<infer S> ? S : never
      >>,
      TReturn,
    >(
      handler: HandlerGen<
        MergedContext<TInitialContext, TInjectedContext>,
        InferSchemaOutput<TInputSchema>,
        TYield,
        TReturn,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): DecoratedProcedure<
      TInitialContext,
      TInjectedContext,
      TInputSchema,
      Schema<Exclude<TReturn, AnyORPCError>>,
      TErrorMap,
      Extract<TReturn | InferYieldError<TYield>, AnyORPCError>
    >
  }

  interface BuilderWithOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    effect<
      TYield extends YieldWrap<Effect.Effect<
        any,
        any,
        MergedContext<TInitialContext, TInjectedContext> extends WithEffectContext<infer S> ? S : never
      >>,
      TReturn extends InferSchemaInput<TOutputSchema> | AnyORPCError,
    >(
      handler: HandlerGen<
        MergedContext<TInitialContext, TInjectedContext>,
        InferSchemaOutput<InitialInputSchema>,
        TYield,
        TReturn,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): DecoratedProcedure<
      TInitialContext,
      TInjectedContext,
      InitialInputSchema,
      TOutputSchema,
      TErrorMap,
      Extract<TReturn | InferYieldError<TYield>, AnyORPCError>
    >
  }

  interface BuilderWithInputOutput<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    effect<
      TYield extends YieldWrap<Effect.Effect<
        any,
        any,
        MergedContext<TInitialContext, TInjectedContext> extends WithEffectContext<infer S> ? S : never
      >>,
      TReturn extends InferSchemaInput<TOutputSchema> | AnyORPCError,
    >(
      handler: HandlerGen<
        MergedContext<TInitialContext, TInjectedContext>,
        InferSchemaOutput<TInputSchema>,
        TYield,
        TReturn,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): DecoratedProcedure<
      TInitialContext,
      TInjectedContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap,
      Extract<TReturn | InferYieldError<TYield>, AnyORPCError>
    >
  }

  interface ProcedureImplementer<
    TInitialContext extends Context,
    TInjectedContext extends Context,
    TInputSchema extends AnySchema,
    TOutputSchema extends AnySchema,
    TErrorMap extends ErrorMap,
  > {
    effect(
      handler: HandlerGen<
        MergedContext<TInitialContext, TInjectedContext>,
        InferSchemaOutput<TInputSchema>,
        YieldWrap<Effect.Effect<
          any,
          any,
          MergedContext<TInitialContext, TInjectedContext> extends WithEffectContext<infer S> ? S : never
        >>,
        AnyORPCError | InferSchemaInput<TOutputSchema>,
        ORPCErrorConstructorMap<TErrorMap>
      >,
    ): ImplementedProcedure<
      TInitialContext,
      TInjectedContext,
      TInputSchema,
      TOutputSchema,
      TErrorMap
    >
  }
}

Builder.prototype.effect = function effect(handler) {
  return this.handler(handlerGen(handler))
}

ProcedureImplementer.prototype.effect = function effect(handler) {
  return this.handler(handlerGen(handler))
}
