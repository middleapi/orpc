import type { ProcedureClient, RouterClient } from '@orpc/server'
import { createGeneralUtils, type GeneralUtils } from './utils-general'
import { createProcedureUtils, type ProcedureUtils } from './utils-procedure'

export type RouterUtils<T extends RouterClient<any, any>> =
  T extends ProcedureClient<infer TInput, infer TOutput, infer TClientContext>
    ? ProcedureUtils<TInput, TOutput, TClientContext> & GeneralUtils<TInput>
    : {
      [K in keyof T]: T[K] extends RouterClient<any, any> ? RouterUtils<T[K]> : never
    } & GeneralUtils<unknown>

/**
 * @param client - The client create form `@orpc/client`
 * @param path - The base path for query key
 */
export function createRouterUtils<T extends RouterClient<any, any>>(
  client: T,
  path: string[] = [],
): RouterUtils<T> {
  const generalUtils = createGeneralUtils(path)
  const procedureUtils = createProcedureUtils(client as any, path)

  const recursive = new Proxy({
    ...generalUtils,
    ...procedureUtils,
  }, {
    get(target, prop) {
      const value = Reflect.get(target, prop)

      if (typeof prop !== 'string') {
        return value
      }

      const nextUtils = createRouterUtils((client as any)[prop], [...path, prop])

      if (typeof value !== 'function') {
        return nextUtils
      }

      return new Proxy(value, {
        get(_, prop) {
          return Reflect.get(nextUtils, prop)
        },
      })
    },
  })

  return recursive as any
}
