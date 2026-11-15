/**
 * Picks the keys of `T` that also exist in `U`.
 * A union `T` is also picked per member and the results are intersected,
 * so `U` must satisfy every member that has the key.
 *
 * The leading `Pick` keeps the result assignable to `T`'s constraint.
 */
export type IntersectPick<T, U> = Pick<T, keyof T & keyof U> &
  ((T extends any ? (x: Pick<T, keyof T & keyof U>) => void : never) extends (x: infer I) => void
    ? I
    : never)

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
