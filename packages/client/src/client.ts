import type { Interceptor, PromiseWithError } from '@orpc/shared'
import type { AnyNestedClient, Client, ClientContext, ClientLink, ClientOptions, InferClientContext, InferClientError } from './types'
import { getOrBind, intercept, toArray } from '@orpc/shared'
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from './consts'
import { resolveClientRest } from './utils'

export interface ORPCClientInterceptorOptions<TClientContext extends ClientContext, TInput> extends ClientOptions<TClientContext> {
  path: string[]
  input: TInput
}

export type ORPCClientInterceptor<TClientContext extends ClientContext, TInput, TOutput, TError>
  = Interceptor<ORPCClientInterceptorOptions<TClientContext, TInput>, PromiseWithError<TOutput, TError>>

export interface ORPCClientScopedOptions<TClientContext extends ClientContext, TInput, TOutput, TError> {

  /**
   * Interceptors that wrap the entire client call lifecycle.
   */
  interceptors?: ORPCClientInterceptor<TClientContext, TInput, TOutput, TError>[]
}

export type ORPCClientScoped<T extends AnyNestedClient>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? ORPCClientScopedOptions<UClientContext, UInput, UOutput, UError>
    : {
        [K in keyof T]?: T[K] extends AnyNestedClient ? ORPCClientScoped<T[K]> : never
      }

export interface ORPCClientOptions<T extends AnyNestedClient> {
  /**
   * Use as base path for all procedure, useful when you only want to call a subset of the procedure.
   */
  path?: string[]

  /**
   * Interceptors that wrap the entire client call lifecycle, applied to every procedure call.
   */
  interceptors?: ORPCClientInterceptor<InferClientContext<T>, unknown, unknown, InferClientError<T>>[]

  /**
   * Per-procedure options following the shape of the router.
   * Allows fine-grained configuration (e.g. additional interceptors) for individual procedures
   * without affecting the rest of the router.
   */
  scoped?: ORPCClientScoped<T>
}

export function createORPCClient<T extends AnyNestedClient>(
  link: ClientLink<InferClientContext<T>>,
  { path = [], ...options }: NoInfer<ORPCClientOptions<T>> = {},
): T {
  const procedureClient: Client<InferClientContext<T>, unknown, unknown, InferClientError<T>> = (...rest) => {
    const [input, callOptions] = resolveClientRest(rest)
    const interceptors = [
      ...toArray(options.interceptors),
      ...toArray(options.scoped?.interceptors) as ORPCClientInterceptor<InferClientContext<T>, unknown, unknown, InferClientError<T>>[],
    ]

    return intercept(
      interceptors,
      { ...callOptions, input, path },
      ({ path, input, ...callOptions }) => link.call(path, input, callOptions),
    )
  }

  const recursive = new Proxy(procedureClient, {
    get(target, key) {
      if (typeof key !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(key)) {
        return getOrBind(target, key)
      }

      const scoped = options.scoped === undefined
        ? undefined
        : (options.scoped as Record<string, unknown>)[key] as ORPCClientOptions<T>['scoped']

      return createORPCClient(link, {
        ...options,
        path: [...path, key],
        scoped,
      })
    },
  })

  return recursive as any
}
