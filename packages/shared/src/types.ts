/**
 * Per member of `T`: a member whose keys `U` all replaces must be replaced by
 * a valid `TAll` (narrowing); otherwise `U` must match the member's keys.
 * `UKeys` holds the keys of every member of `U`, so a union `U` can replace `T`.
 */
type IntersectPickMembers<T, U, TAll, UKeys> = (
  T extends any ? (x: [keyof T] extends [UKeys] ? TAll : Pick<T, keyof T & keyof U>) => void : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * Picks the keys of `T` that also exist in `U`.
 * A union `T` is also checked per member, so `U` must match every member it
 * only partly overrides, while it may still narrow `T` to some of its members.
 *
 * The leading `Pick` keeps the result assignable to `T`'s constraint.
 */
export type IntersectPick<T, U> = Pick<T, keyof T & keyof U> &
  IntersectPickMembers<T, U, T, U extends any ? keyof U : never>

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
