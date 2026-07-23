export type IntersectPick<T, U> = Pick<T, keyof T & keyof U>

/**
 * Make the given keys optional while keeping the rest unchanged.
 */
export type SetOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

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
