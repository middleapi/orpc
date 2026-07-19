import type { AnyNestedClient, Client, InferClientContext, InferClientError } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { EntryKey } from '@pinia/colada'
import type { BuildKeyOptions } from './key'
import type { RouterUtilsPlugin } from './plugin'
import type { ProcedureUtilsInfiniteInterceptor, ProcedureUtilsMutationInterceptor, ProcedureUtilsOptions, ProcedureUtilsQueryInterceptor } from './procedure-utils'
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from '@orpc/client'
import { bindMethods, get, getOrBind, isTypescriptObject, toArray } from '@orpc/shared'
import { buildKey } from './key'
import { CompositeRouterUtilsPlugin } from './plugin'
import { ProcedureUtils } from './procedure-utils'

export class SharedRouterUtils<TInput> {
  constructor(
    private readonly path: string[],
    private readonly prefix?: string,
  ) {}

  /**
   * Generate a query/mutation key for checking status, invalidate, set, get, etc.
   *
   * @see {@link https://orpc.dev/docs/integrations/pinia-colada#query-mutation-key Pinia Colada Query/Mutation Key Docs}
   */
  key(options?: Omit<BuildKeyOptions<TInput>, 'prefix'>): EntryKey {
    return buildKey(this.path, { ...options, prefix: this.prefix })
  }
}

export type RouterUtils<T extends AnyNestedClient>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? Public<ProcedureUtils<UClientContext, UInput, UOutput, UError>> & Public<SharedRouterUtils<UInput>>
    : {
      [K in keyof T]: T[K] extends AnyNestedClient ? RouterUtils<T[K]> : never
    } & Public<SharedRouterUtils<unknown>>

export type RouterUtilsScoped<T extends AnyNestedClient>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? ProcedureUtilsOptions<UClientContext, UInput, UOutput, UError>
    : {
        [K in keyof T]?: T[K] extends AnyNestedClient ? RouterUtilsScoped<T[K]> : never
      }

export interface RouterUtilsOptions<T extends AnyNestedClient> {
  /**
   * Prepended as the first element of every entry key when present.
   * Use this to avoid key conflicts when mounting multiple router utils
   * instances for the same client.
   */
  prefix?: string | undefined

  /**
   * Interceptors that intercept query inside .queryOptions
   */
  queryInterceptors?: ProcedureUtilsQueryInterceptor<InferClientContext<T>, unknown, unknown, InferClientError<T>>[]

  /**
   * Interceptors that intercept query inside .infiniteOptions
   */
  infiniteInterceptors?: ProcedureUtilsInfiniteInterceptor<InferClientContext<T>, unknown, unknown, InferClientError<T>>[]

  /**
   * Interceptors that intercept mutation inside .mutationOptions
   */
  mutationInterceptors?: ProcedureUtilsMutationInterceptor<InferClientContext<T>, unknown, unknown, InferClientError<T>>[]

  /**
   * Per-procedure options following the shape of the router.
   * Allows fine-grained configuration of individual procedure utils
   * without affecting the rest of the router.
   */
  scoped?: RouterUtilsScoped<T> | undefined

  /**
   * Plugins to extend router utils behavior.
   */
  plugins?: RouterUtilsPlugin<T>[] | undefined
}

/**
 * Create a router utils from a client.
 *
 * @info Both client-side and server-side clients are supported.
 * @see {@link https://orpc.dev/docs/integrations/pinia-colada Pinia Colada Docs}
 */
export function createRouterUtils<T extends AnyNestedClient>(
  client: T,
  options: NoInfer<RouterUtilsOptions<T>> = {},
): RouterUtils<T> {
  const plugin = new CompositeRouterUtilsPlugin<T>(options.plugins)
  options = plugin.init(options)

  return createRouterUtilsInternal(client, [], options, plugin)
}

function createRouterUtilsInternal<T extends AnyNestedClient>(
  client: T,
  path: string[],
  options: RouterUtilsOptions<T>,
  plugin: CompositeRouterUtilsPlugin<any>,
): RouterUtils<T> {
  const sharedUtils = bindMethods(new SharedRouterUtils(path, options.prefix))

  const procedureUtils = typeof client === 'function' && (options.scoped === undefined || isProcedureUtilsOptions(options.scoped))
    ? bindMethods(new ProcedureUtils(
        path,
        client,
        plugin.initProcedureOptions(path, {
          ...options.scoped,
          queryInterceptors: [...toArray(options.queryInterceptors) as any, ...toArray(options.scoped?.queryInterceptors)],
          infiniteInterceptors: [...toArray(options.infiniteInterceptors) as any, ...toArray(options.scoped?.infiniteInterceptors)],
          mutationInterceptors: [...toArray(options.mutationInterceptors) as any, ...toArray(options.scoped?.mutationInterceptors)],
        }),
        options.prefix,
      ))
    : undefined

  const recursive = new Proxy({
    ...sharedUtils,
    ...procedureUtils,
  }, {
    get(target, prop) {
      const value = getOrBind(target, prop)
      const nextClient = get(client, [prop])

      if (typeof prop !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(prop) || !isTypescriptObject(nextClient)) {
        return value
      }

      const nextUtils = createRouterUtilsInternal(nextClient as any, [...path, prop], {
        ...options,
        scoped: get(options.scoped, [prop]) as any,
      }, plugin)

      if (typeof value !== 'function') {
        return nextUtils
      }

      return new Proxy(value, {
        get(target, prop) {
          if (typeof prop !== 'string' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(prop)) {
            return getOrBind(target, prop)
          }

          return getOrBind(nextUtils, prop)
        },
      })
    },
  })

  return recursive as any
}

function isProcedureUtilsOptions(value: unknown): value is ProcedureUtilsOptions<any, any, any, any> {
  if (!isTypescriptObject(value)) {
    return false
  }

  if (value.queryInterceptors !== undefined && !Array.isArray(value.queryInterceptors)) {
    return false
  }

  if (value.infiniteInterceptors !== undefined && !Array.isArray(value.infiniteInterceptors)) {
    return false
  }

  if (value.mutationInterceptors !== undefined && !Array.isArray(value.mutationInterceptors)) {
    return false
  }

  return true
}
