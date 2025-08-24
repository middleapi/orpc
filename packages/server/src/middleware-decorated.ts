import type { ErrorMap, Meta } from '@orpc/contract'
import type { IntersectPick } from '@orpc/shared'
import type { Context, MergedCurrentContext, MergedInitialContext } from './context'
import type { ORPCErrorConstructorMap } from './error'
import type { AnyMiddleware, MapInputMiddleware, Middleware } from './middleware'

export interface DecoratedMiddleware<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
> extends Middleware<TInContext, TOutContext, TInput, TOutput, TErrorConstructorMap, TMeta> {
  /**
   * Error map associated with this middleware (if any)
   * @internal
   */
  errorMap?: ErrorMap
  /**
   * Change the expected input type by providing a map function.
   */
  mapInput<UInput>(
    map: MapInputMiddleware<UInput, TInput>,
  ): DecoratedMiddleware<TInContext, TOutContext, UInput, TOutput, TErrorConstructorMap, TMeta>

  /**
   * Concatenates two middlewares.
   *
   * @info Pass second argument to map the input.
   * @see {@link https://orpc.unnoq.com/docs/middleware#concatenation Middleware Concatenation Docs}
   */
  concat<
    UOutContext extends IntersectPick<MergedCurrentContext<TInContext, TOutContext>, UOutContext>,
    UInput extends TInput,
    UInContext extends Context = MergedCurrentContext<TInContext, TOutContext>,
  >(
    middleware: Middleware<
      UInContext | MergedCurrentContext<TInContext, TOutContext>,
      UOutContext,
      UInput,
      TOutput,
      TErrorConstructorMap,
      TMeta
    >,
  ): DecoratedMiddleware<
    MergedInitialContext<TInContext, UInContext, MergedCurrentContext<TInContext, TOutContext>>,
    MergedCurrentContext<TOutContext, UOutContext>,
    UInput,
    TOutput,
    TErrorConstructorMap,
    TMeta
  >

  /**
   * Concatenates two middlewares.
   *
   * @info Pass second argument to map the input.
   * @see {@link https://orpc.unnoq.com/docs/middleware#concatenation Middleware Concatenation Docs}
   */
  concat<
    UOutContext extends IntersectPick<MergedCurrentContext<TInContext, TOutContext>, UOutContext>,
    UInput extends TInput,
    UMappedInput,
    UInContext extends Context = MergedCurrentContext<TInContext, TOutContext>,
  >(
    middleware: Middleware<
      UInContext | MergedCurrentContext<TInContext, TOutContext>,
      UOutContext,
      UMappedInput,
      TOutput,
      TErrorConstructorMap,
      TMeta
    >,
    mapInput: MapInputMiddleware<UInput, UMappedInput>,
  ): DecoratedMiddleware<
    MergedInitialContext<TInContext, UInContext, MergedCurrentContext<TInContext, TOutContext>>,
    MergedCurrentContext<TOutContext, UOutContext>,
    UInput,
    TOutput,
    TErrorConstructorMap,
    TMeta
  >
}

export type AnyDecoratedMiddleware = DecoratedMiddleware<any, any, any, any, any, any>

export function decorateMiddleware<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TErrorConstructorMap extends ORPCErrorConstructorMap<any>,
  TMeta extends Meta,
>(
  middleware: Middleware<TInContext, TOutContext, TInput, TOutput, TErrorConstructorMap, TMeta>
    | DecoratedMiddleware<TInContext, TOutContext, TInput, TOutput, TErrorConstructorMap, TMeta>,
  errorMap?: ErrorMap,
): DecoratedMiddleware<TInContext, TOutContext, TInput, TOutput, TErrorConstructorMap, TMeta> {
  const decorated = ((...args) => middleware(...args)) as DecoratedMiddleware<TInContext, TOutContext, TInput, TOutput, TErrorConstructorMap, TMeta>

  // Attach error map if provided
  if (errorMap) {
    decorated.errorMap = errorMap
  }
  if ('errorMap' in middleware) {
    decorated.errorMap = middleware.errorMap
  }

  decorated.mapInput = (mapInput) => {
    const mapped = decorateMiddleware(
      (options, input, ...rest) => middleware(options as any, mapInput(input as any), ...rest as [any]),
      decorated.errorMap, // Preserve error map
    )

    return mapped as any
  }

  decorated.concat = (concatMiddleware: AnyMiddleware | AnyDecoratedMiddleware, mapInput?: MapInputMiddleware<any, any>) => {
    const mapped = mapInput
      ? decorateMiddleware(concatMiddleware).mapInput(mapInput)
      : concatMiddleware

    const combinedErrorMap = {
      ...decorated.errorMap,
      ...('errorMap' in concatMiddleware ? concatMiddleware.errorMap : undefined),
    }

    const concatted = decorateMiddleware((options, input, output, ...rest) => {
      const merged = middleware({
        ...options,
        next: (...[nextOptions1]: [any]) => mapped({
          ...options,
          context: { ...options.context, ...nextOptions1?.context },
          next: (...[nextOptions2]) => options.next({ context: { ...nextOptions1?.context, ...nextOptions2?.context } }) as any,
        }, input, output, ...rest),
      } as any, input as any, output as any, ...rest)

      return merged
    }, combinedErrorMap)

    return concatted as any
  }

  return decorated
}
