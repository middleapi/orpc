import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import { ORPCError } from '@orpc/client'
import { getOwn } from '@orpc/shared'
import { Effect, Function } from 'effect'

type AnyEffect = Effect.Effect<any, any, any>

/**
 * Codes an `ORPCError` in `E` can have. Any code is possible when `E`
 * can hold hidden `ORPCError` instances.
 */
type ORPCErrorCodeOf<E> = E extends ORPCError<infer TCode, any> ? TCode : AnyORPCError extends E ? ORPCErrorCode : never

/**
 * The `ORPCError`s in `E` whose code can be `TCode`, narrowed to `TCode`.
 * Hidden `ORPCError` instances have unknown data.
 */
type ORPCErrorWithCode<E, TCode extends ORPCErrorCode> = E extends AnyORPCError
  ? E extends ORPCError<infer UCode, infer UData>
    ? 0 extends (1 & UCode)
      ? ORPCError<TCode, UData>
      : [UCode] extends [TCode]
          ? E
          : [UCode & TCode] extends [never] ? never : ORPCError<UCode & TCode, UData>
    : never
  : AnyORPCError extends E ? ORPCError<TCode, unknown> : never

/**
 * `E` without the `ORPCError`s whose every possible code is in `TCode`.
 */
type ExcludeORPCErrorCode<E, TCode extends string> = E extends ORPCError<infer UCode, any>
  ? 0 extends (1 & UCode) ? E : [UCode] extends [TCode] ? never : E
  : E

/**
 * `TCode` if it is a single literal code, `never` otherwise.
 */
type LiteralORPCErrorCode<TCode extends string, UCode extends string = TCode> = UCode extends string
  ? [TCode] extends [UCode] ? Record<never, never> extends Record<UCode, unknown> ? never : UCode : never
  : never

/**
 * The codes `TCases` handles: required, literal keys with a function value.
 */
type HandledORPCErrorCodes<TCases> = {
  [K in keyof TCases]-?: Record<never, never> extends Pick<TCases, K> ? never : TCases[K] extends (...args: any[]) => any ? K : never
}[keyof TCases] & string

/**
 * The handlers `catchORPCErrorCodes` accepts, keyed by the codes in `E`.
 * Non-literal codes (e.g. hidden `ORPCError` instances) become an index
 * signature, whose handler is bivariant so it accepts every literal handler.
 */
type ORPCErrorCodeCases<E> = {
  [K in ORPCErrorCodeOf<E>]?: Record<never, never> extends Record<K, unknown>
    ? { bivarianceHack(error: ORPCErrorWithCode<E, K>): AnyEffect }['bivarianceHack']
    : (error: ORPCErrorWithCode<E, K>) => AnyEffect
}

/**
 * The effects the handlers in `TCases` can return.
 */
type ORPCErrorCodeCasesEffect<TCases, TCase = TCases[keyof TCases]> = TCase extends (...args: any[]) => infer U ? U : never

/**
 * Recovers from `ORPCError` failures in the error channel of an effect.
 * Other failures re-fail with their original cause. Because failure types
 * like `Error` can also hold `ORPCError` instances at runtime, the handler
 * can also receive such hidden errors with unknown code and data.
 *
 * Supports both data-first `catchORPCError(effect, handler)` and data-last
 * `effect.pipe(catchORPCError(handler))` styles.
 *
 * @example
 * ```ts
 * declare const program: Effect.Effect<string, ORPCError<'NOT_FOUND', undefined> | TypeError>
 *
 * const recovered = program.pipe(
 *   catchORPCError(error => Effect.succeed(`caught ${error.code}`)),
 * )
 * ```
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#catching-orpcerrors | Effect Integration - Catching ORPCErrors}
 */
export const catchORPCError: {
  <E, A2, E2, R2>(
    f: (error: E extends AnyORPCError ? E : AnyORPCError extends E ? ORPCError<ORPCErrorCode, unknown> : never) => Effect.Effect<A2, E2, R2>,
  ): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A | A2, E2 | Exclude<E, AnyORPCError>, R | R2>
  <A, E, R, A2, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (error: E extends AnyORPCError ? E : AnyORPCError extends E ? ORPCError<ORPCErrorCode, unknown> : never) => Effect.Effect<A2, E2, R2>,
  ): Effect.Effect<A | A2, E2 | Exclude<E, AnyORPCError>, R | R2>
} = Function.dual(
  2,
  (
    self: Effect.Effect<any, any, any>,
    f: (error: AnyORPCError) => Effect.Effect<any, any, any>,
  ) => self.pipe(
    Effect.catchIf((error): error is AnyORPCError => error instanceof ORPCError, f),
  ),
)

/**
 * Recovers from `ORPCError` failures with a matching code in the error channel of an effect.
 * Other failures re-fail with their original cause. The `code` argument is
 * suggested and restricted to the codes present in the error channel, and is
 * unrestricted when the channel contains failure types like `Error` that can
 * hold hidden `ORPCError` instances, whose data is unknown.
 *
 * Supports both data-first `catchORPCErrorCode(effect, code, handler)` and
 * data-last `effect.pipe(catchORPCErrorCode(code, handler))` styles.
 *
 * @example
 * ```ts
 * declare const program: Effect.Effect<
 *   string,
 *   ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', undefined>
 * >
 *
 * const recovered = program.pipe(
 *   catchORPCErrorCode('NOT_FOUND', error => Effect.succeed(error.data.id)),
 * )
 * ```
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#catching-orpcerrors | Effect Integration - Catching ORPCErrors}
 */
export const catchORPCErrorCode: {
  <const TCode extends ORPCErrorCodeOf<E>, E, A2, E2, R2>(
    code: TCode,
    f: (error: ORPCErrorWithCode<E, TCode>) => Effect.Effect<A2, E2, R2>,
  ): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A | A2, E2 | ExcludeORPCErrorCode<E, LiteralORPCErrorCode<TCode>>, R | R2>
  <A, E, R, const TCode extends ORPCErrorCodeOf<E>, A2, E2, R2>(
    self: Effect.Effect<A, E, R>,
    code: TCode,
    f: (error: ORPCErrorWithCode<E, TCode>) => Effect.Effect<A2, E2, R2>,
  ): Effect.Effect<A | A2, E2 | ExcludeORPCErrorCode<E, LiteralORPCErrorCode<TCode>>, R | R2>
} = Function.dual(
  3,
  (
    self: Effect.Effect<any, any, any>,
    code: ORPCErrorCode,
    f: (error: AnyORPCError) => Effect.Effect<any, any, any>,
  ) => self.pipe(
    Effect.catchIf((error): error is AnyORPCError => error instanceof ORPCError && error.code === code, f),
  ),
)

/**
 * Recovers from `ORPCError` failures using a map of codes to handlers in the
 * error channel of an effect. Other failures re-fail with their original
 * cause. The keys are suggested and restricted to the codes present in the
 * error channel, and are unrestricted when the channel contains failure types
 * like `Error` that can hold hidden `ORPCError` instances, whose data is unknown.
 *
 * Supports both data-first `catchORPCErrorCodes(effect, cases)` and data-last
 * `effect.pipe(catchORPCErrorCodes(cases))` styles.
 *
 * @example
 * ```ts
 * declare const program: Effect.Effect<
 *   string,
 *   ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', undefined>
 * >
 *
 * const recovered = program.pipe(
 *   catchORPCErrorCodes({
 *     NOT_FOUND: error => Effect.succeed(error.data.id),
 *     CONFLICT: error => Effect.succeed(error.message),
 *   }),
 * )
 * ```
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#catching-orpcerrors | Effect Integration - Catching ORPCErrors}
 */
export const catchORPCErrorCodes: {
  <E, Cases extends ORPCErrorCodeCases<E> & { [K in Exclude<keyof Cases, ORPCErrorCodeOf<E>>]: never }>(
    cases: Cases,
  ): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<
    A | Effect.Success<ORPCErrorCodeCasesEffect<Cases>>,
    ExcludeORPCErrorCode<E, HandledORPCErrorCodes<Cases>> | Effect.Error<ORPCErrorCodeCasesEffect<Cases>>,
    R | Effect.Services<ORPCErrorCodeCasesEffect<Cases>>
  >
  <A, E, R, Cases extends ORPCErrorCodeCases<E> & { [K in Exclude<keyof Cases, ORPCErrorCodeOf<E>>]: never }>(
    self: Effect.Effect<A, E, R>,
    cases: Cases,
  ): Effect.Effect<
    A | Effect.Success<ORPCErrorCodeCasesEffect<Cases>>,
    ExcludeORPCErrorCode<E, HandledORPCErrorCodes<Cases>> | Effect.Error<ORPCErrorCodeCasesEffect<Cases>>,
    R | Effect.Services<ORPCErrorCodeCasesEffect<Cases>>
  >
} = Function.dual(
  2,
  (
    self: Effect.Effect<any, any, any>,
    cases: Record<string, ((error: AnyORPCError) => Effect.Effect<any, any, any>) | undefined>,
  ) => self.pipe(
    Effect.catchIf(
      (error): error is AnyORPCError => error instanceof ORPCError && typeof getOwn(cases, error.code) === 'function',
      error => getOwn(cases, error.code)!(error),
    ),
  ),
)
