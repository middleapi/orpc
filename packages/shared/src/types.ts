export type IntersectPick<T, U> = Pick<T, keyof T & keyof U>

/**
 * Remove protected/private properties/methods
 */
export type Public<T> = Pick<T, keyof T>

export type PromiseWithError<T, TError> = Promise<T> & { __error?: { type: TError } }

/**
 * The place where you can config the orpc types.
 *
 * - `ThrowableError` the error type that represent throwable errors should be `Error` or `null | undefined | {}` if you want more strict.
 */
export interface Registry {

}

export type ThrowableError = Registry extends { ThrowableError: infer T } ? T : Error
