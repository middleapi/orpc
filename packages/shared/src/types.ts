/**
 * Whether overriding every member of `T` with every member of `U` gives a valid `TAll`.
 */
type IsValidOverride<T, U, TAll = T> = [
  U extends any
    ? T extends any
      ? [DistributiveOmit<T, keyof U> & U] extends [TAll]
        ? never
        : false
      : never
    : never,
] extends [never]
  ? true
  : false

/**
 * Requires every member of `U` to match every member of `T` on the keys they share.
 * Only used to reject (and report) an invalid override, so it can be strict.
 */
type StrictIntersectPick<T, U> = (
  U extends any
    ? (
        x: (
          T extends any
            ? (x: { [K in keyof T as K extends keyof U ? K : never]: T[K] }) => void
            : never
        ) extends (x: infer I) => void
          ? I
          : never,
      ) => void
    : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * Picks the keys of `T` that also exist in `U`, as the constraint on a context
 * override `U`. Unions are checked per member: `U` is accepted when overriding
 * any member of `T` with any member of `U` still gives a valid `T`, so it may
 * narrow `T` but not leave a member with a conflicting key.
 *
 * The leading `Pick` keeps the result assignable to `T`'s constraint.
 */
export type IntersectPick<T, U> = Pick<T, keyof T & keyof U> &
  (IsValidOverride<T, U> extends true ? unknown : StrictIntersectPick<T, U>)

/**
 * Like `Omit`, but distributes over unions and keeps known keys beside index signatures.
 */
export type DistributiveOmit<T, K extends PropertyKey> = {
  [P in keyof T as P extends K ? never : P]: T[P]
}

/**
 * Remove protected/private properties/methods
 */
export type Public<T> = Pick<T, keyof T>

/**
 * A value, or a promise or thenable of it.
 */
export type Promisable<T> = Promise<T> | T | PromiseLike<T>

export type PromiseWithError<T, TError> = Promise<T> & { __error?: { type: TError } }

/**
 * The place where you can config the orpc types.
 *
 * - `ThrowableError` the error type that represent throwable errors should be `Error` or `null | undefined | {}` if you want more strict.
 */
export interface Registry {}

export type ThrowableError = Registry extends { ThrowableError: infer T } ? T : Error
