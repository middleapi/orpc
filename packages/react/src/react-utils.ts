import type { ProcedureClient, RouterClient } from '@orpc/server'
import type { ORPCContextValue } from './react-context'
import { createGeneralUtils, type GeneralUtils } from './general-utils'
import { createProcedureUtils, type ProcedureUtils } from './procedure-utils'

export type ORPCUtils<T extends RouterClient<any, any>> =
  T extends ProcedureClient<infer TInput, infer TOutput, any>
    ? ProcedureUtils<TInput, TOutput> & GeneralUtils<TInput, TOutput>
    : {
      [K in keyof T]: T[K] extends RouterClient<any, any> ? ORPCUtils<T[K]> : never
    } & GeneralUtils<unknown, unknown>

export interface CreateORPCUtilsOptions<T extends RouterClient<any, any>> {
  contextValue: ORPCContextValue<T>

  /**
   * The path of the router.
   *
   * @internal
   */
  path?: string[]
}

export function createORPCUtils<T extends RouterClient<any, any>>(
  options: CreateORPCUtilsOptions<T>,
): ORPCUtils<T> {
  const path = options.path ?? []
  const client = options.contextValue.client as any

  const generalUtils = createGeneralUtils({
    queryClient: options.contextValue.queryClient,
    path,
  })

  // for sure root is not procedure, so do not it procedure utils on root
  const procedureUtils = path.length
    ? createProcedureUtils({
        client,
        queryClient: options.contextValue.queryClient,
        path,
      })
    : {}

  return new Proxy(
    {
      ...generalUtils,
      ...procedureUtils,
    },
    {
      get(target, key) {
        const value = Reflect.get(target, key)

        if (typeof key !== 'string') {
          return value
        }

        const nextUtils = createORPCUtils({
          ...options,
          contextValue: {
            ...options.contextValue,
            client: client[key],
          },
          path: [...path, key],
        })

        if (typeof value !== 'function') {
          return nextUtils
        }

        return new Proxy(value, {
          get(_, key) {
            return Reflect.get(nextUtils, key)
          },
        })
      },
    },
  ) as any
}
