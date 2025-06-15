import type { Promisable } from 'type-fest'
import type { PromiseWithError, ThrowableError } from './types'

export type InterceptableOptions = Record<string, any>

export type InterceptorOptions<
  TOptions extends InterceptableOptions,
  TResult,
> = Omit<TOptions, 'next'> & {
  next(options?: TOptions): TResult
}

export type Interceptor<
  TOptions extends InterceptableOptions,
  TResult,
> = (options: InterceptorOptions<TOptions, TResult>) => TResult

/**
 * Can used for interceptors or middlewares
 */
export function onStart<T, TOptions extends { next(): any }, TRest extends any[]>(
  callback: NoInfer<(options: TOptions, ...rest: TRest) => Promisable<void>>,
): (options: TOptions, ...rest: TRest) => T | Promise<Awaited<ReturnType<TOptions['next']>>> {
  return async (options, ...rest) => {
    await callback(options, ...rest)
    return await options.next()
  }
}

/**
 * Can used for interceptors or middlewares
 */
export function onSuccess<T, TOptions extends { next(): any }, TRest extends any[]>(
  callback: NoInfer<(result: Awaited<ReturnType<TOptions['next']>>, options: TOptions, ...rest: TRest) => Promisable<void>>,
): (options: TOptions, ...rest: TRest) => T | Promise<Awaited<ReturnType<TOptions['next']>>> {
  return async (options, ...rest) => {
    const result = await options.next()
    await callback(result, options, ...rest)
    return result
  }
}

/**
 * Can used for interceptors or middlewares
 */
export function onError<T, TOptions extends { next(): any }, TRest extends any[]>(
  callback: NoInfer<(
    error: ReturnType<TOptions['next']> extends PromiseWithError<any, infer E> ? E : ThrowableError,
    options: TOptions,
    ...rest: TRest
  ) => Promisable<void>>,
): (options: TOptions, ...rest: TRest) => T | Promise<Awaited<ReturnType<TOptions['next']>>> {
  return async (options, ...rest) => {
    try {
      return await options.next()
    }
    catch (error) {
      await callback(error as any, options, ...rest)
      throw error
    }
  }
}

export type OnFinishState<TResult, TError>
  = | [error: TError, data: undefined, isSuccess: false]
    | [error: null, data: TResult, isSuccess: true]

/**
 * Can used for interceptors or middlewares
 */
export function onFinish<T, TOptions extends { next(): any }, TRest extends any[]>(
  callback: NoInfer<(
    state: OnFinishState<
      Awaited<ReturnType<TOptions['next']>>,
      ReturnType<TOptions['next']> extends PromiseWithError<any, infer E> ? E : ThrowableError
    >,
    options: TOptions,
    ...rest: TRest
  ) => Promisable<void>>,
): (options: TOptions, ...rest: TRest) => T | Promise<Awaited<ReturnType<TOptions['next']>>> {
  let state: any

  return async (options, ...rest) => {
    try {
      const result = await options.next()
      state = [null, result, true]
      return result
    }
    catch (error) {
      state = [error, undefined, false]
      throw error
    }
    finally {
      await callback(state, options, ...rest)
    }
  }
}

export function intercept<TOptions extends InterceptableOptions, TResult>(
  interceptors: Interceptor<TOptions, TResult>[],
  options: NoInfer<TOptions>,
  main: NoInfer<(options: TOptions) => TResult>,
): TResult {
  const next = (options: TOptions, index: number): TResult => {
    const interceptor = interceptors[index]

    if (!interceptor) {
      return main(options)
    }

    return interceptor({
      ...options,
      next: (newOptions: TOptions = options) => next(newOptions, index + 1),
    })
  }

  return next(options, 0)
}
