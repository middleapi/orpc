import type { Client, NestedClient } from '@orpc/client'
import type { GeneralUtils } from './general-utils'
import type { experimental_ProcedureUtilsDefaults, ProcedureUtils } from './procedure-utils'
import { get, toArray } from '@orpc/shared'
import { createGeneralUtils } from './general-utils'
import { createProcedureUtils } from './procedure-utils'

export type RouterUtils<T extends NestedClient<any>>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? ProcedureUtils<UClientContext, UInput, UOutput, UError> & GeneralUtils<UInput>
    : {
      [K in keyof T]: T[K] extends NestedClient<any> ? RouterUtils<T[K]> : never
    } & GeneralUtils<unknown>

export type experimental_RouterUtilsDefaults<T extends NestedClient<any>>
  = T extends Client<infer UClientContext, infer UInput, infer UOutput, infer UError>
    ? experimental_ProcedureUtilsDefaults<UClientContext, UInput, UOutput, UError>
    : {
        [K in keyof T]?: T[K] extends NestedClient<any> ? experimental_RouterUtilsDefaults<T[K]> : never
      }

/**
 * @todo remove default generic types on v2
 */
export interface CreateRouterUtilsOptions<T extends NestedClient<any> = NestedClient<any>> {
  path?: readonly string[]
  experimental_defaults?: experimental_RouterUtilsDefaults<T>
}

/**
 * Create a router utils from a client.
 *
 * @info Both client-side and server-side clients are supported.
 * @see {@link https://orpc.unnoq.com/docs/integrations/tanstack-query Tanstack Query Integration}
 */
export function createRouterUtils<T extends NestedClient<any>>(
  client: T,
  options: CreateRouterUtilsOptions<T> = {},
): RouterUtils<T> {
  const path = toArray(options.path)

  const generalUtils = createGeneralUtils(path)
  const procedureUtils = createProcedureUtils(client as any, {
    path,
    experimental_defaults: options.experimental_defaults,
  })

  const recursive = new Proxy({
    ...generalUtils,
    ...procedureUtils,
  }, {
    get(target, prop) {
      const value = Reflect.get(target, prop)

      if (typeof prop !== 'string') {
        return value
      }

      const nextUtils = createRouterUtils((client as any)[prop], {
        ...options,
        path: [...path, prop],
        experimental_defaults: get(options.experimental_defaults, [prop]) as any,
      })

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
