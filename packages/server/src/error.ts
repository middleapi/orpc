import type { ORPCErrorCode, ORPCErrorOptions } from '@orpc/client'
import type { ErrorMap, ErrorMapItem, InferSchemaInput } from '@orpc/contract'
import type { MaybeOptionalOptions, Writable } from '@orpc/shared'
import { ORPCError } from '@orpc/client'
import { getOrBind, resolveMaybeOptionalOptions } from '@orpc/shared'

export type ORPCErrorConstructorMapItemOptions<TData> = Omit<ORPCErrorOptions<TData>, 'status'>

export interface ORPCErrorConstructorMapItem<TCode extends ORPCErrorCode, TInData> {
  (...rest: MaybeOptionalOptions<ORPCErrorConstructorMapItemOptions<TInData>>): ORPCError<TCode, TInData>
}

export type ORPCErrorConstructorMap<T extends ErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<infer UInputSchema>
      ? ORPCErrorConstructorMapItem<K, InferSchemaInput<UInputSchema>>
      : never
    : never
}

/**
 * Creates a map of ORPC error constructors.
 *
 * The returned object is a `Proxy` that allows access to arbitrary error codes:
 * - If the code exists in the provided `errorMap`, the corresponding constructor
 *   will create a **defined** `ORPCError`.
 * - If the code does not exist, a fallback `ORPCError` constructor is returned.
 *
 * The `in` operator can be used to check whether an error code is explicitly
 * defined in the map.
 *
 * @example
 * ```ts
 * const errorMap = createORPCErrorConstructorMap({
 *   NOT_FOUND: {
 *     status: 404,
 *     message: 'Not Found',
 *   },
 * })
 *
 * if ('NOT_FOUND' in errorMap) {
 *   const error = errorMap.NOT_FOUND()
 * }
 * ```
 */
export function createORPCErrorConstructorMap<T extends ErrorMap>(errorMap: T): ORPCErrorConstructorMap<T> {
  const proxy = new Proxy(errorMap, {
    get(target, code) {
      if (typeof code !== 'string') {
        return getOrBind(target, code)
      }

      const item: ORPCErrorConstructorMapItem<string, unknown> = (...rest) => {
        const options = resolveMaybeOptionalOptions(rest)
        const config = errorMap[code]

        const error = new ORPCError(code, {
          message: options.message ?? config?.message,
          data: options.data,
          cause: options.cause,
        })

        if (config) {
          ;(error.defined as Writable<typeof error.defined>) = true
          ;(error.inferable as Writable<typeof error.inferable>) = true
        }

        return error
      }

      return item
    },
  })

  return proxy as any
}
